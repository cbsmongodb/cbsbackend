// "Entered prescriptions" — a rep sees, edits and deletes the doctor
// prescription lines they entered on "Prescription entry".
//   GET    /api/my-entries?period=MM/YYYY[&employee=]   -> lines of that month
//   PUT    /api/my-entries/:id   { quota, prescription } -> fix one line
//   DELETE /api/my-entries/:id                          -> delete one line
//   DELETE /api/my-entries/doctor/:doctorId?period=&employee= -> all lines of a doctor
// Own lines: anyone who may enter prescriptions (sales add). Someone else's
// lines: only managers who see that employee and have sales update / delete.
import express from "express";
import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import DoctorEntrySummary from "../../models/DoctorEntrySummary.js";
import { employeeFromRequest } from "../../middleware/authEmployee.js";
import { canSeeEmployee } from "../../utils/groupVisibility.js";
import { recalculateForPeriod } from "./doctorEntryItems.controller.js";

const router = express.Router();

const isAdmin = (e) => (e?.role?.name || "").toLowerCase() === "admin";
function can(e, action) {
  if (isAdmin(e)) return true;
  const p = e?.role?.privileges;
  const a = p instanceof Map ? p.get("sales") : p?.sales;
  return !!a && a[action] === 1;
}

router.use(async (req, res, next) => {
  try {
    const me = await employeeFromRequest(req);
    if (!me) return res.status(401).json({ error: "Not authenticated" });
    if (!can(me, "read") && !can(me, "add")) return res.status(403).json({ error: "Forbidden" });
    req.employee = me;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
});

function monthStart(period) {
  const m = String(period || "").match(/^(\d{1,2})\/(\d{4})$/);
  return m ? new Date(+m[2], +m[1] - 1, 1) : null;
}

// may the requester change lines that belong to `ownerId`?
async function mayChange(me, ownerId, action) {
  if (String(ownerId) === String(me._id)) return can(me, "add") || can(me, action);
  return can(me, action) && (await canSeeEmployee(me, ownerId));
}

async function cleanupSummary(employee, period) {
  const remaining = await DoctorEntryItem.find({ employee, period }).distinct("drug");
  await DoctorEntrySummary.deleteMany({ employee, period, drug: { $nin: remaining } });
}

router.get("/", async (req, res) => {
  try {
    const period = monthStart(req.query.period);
    if (!period) return res.status(400).json({ error: "period must be MM/YYYY" });
    const employee = req.query.employee || req.employee._id;
    if (!(await canSeeEmployee(req.employee, employee))) return res.status(403).json({ error: "Forbidden" });
    const items = await DoctorEntryItem.find({ employee, period })
      .select("doctor drug hospital quota prescription updatedAt")
      .populate("doctor", "firstName lastName")
      .populate("drug", "name")
      .populate("hospital", "name")
      .lean();
    res.json(items);
  } catch (err) {
    console.error("my-entries list failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const item = await DoctorEntryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ error: "Entry not found" });
    if (!(await mayChange(req.employee, item.employee, "update"))) return res.status(403).json({ error: "Forbidden" });
    for (const f of ["quota", "prescription"]) {
      if (req.body[f] === undefined) continue;
      const n = Number(req.body[f]);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: `${f} must be 0 or more` });
      item[f] = n;
    }
    await item.save();
    await recalculateForPeriod(item.employee, item.period);
    res.json({ _id: item._id, quota: item.quota, prescription: item.prescription });
  } catch (err) {
    console.error("my-entries update failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/doctor/:doctorId", async (req, res) => {
  try {
    const period = monthStart(req.query.period);
    if (!period) return res.status(400).json({ error: "period must be MM/YYYY" });
    const employee = req.query.employee || req.employee._id;
    if (!(await mayChange(req.employee, employee, "delete"))) return res.status(403).json({ error: "Forbidden" });
    const r = await DoctorEntryItem.deleteMany({ employee, period, doctor: req.params.doctorId });
    await cleanupSummary(employee, period);
    await recalculateForPeriod(employee, period);
    res.json({ success: true, deletedCount: r.deletedCount });
  } catch (err) {
    console.error("my-entries delete doctor failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const item = await DoctorEntryItem.findById(req.params.id).lean();
    if (!item) return res.status(404).json({ error: "Entry not found" });
    if (!(await mayChange(req.employee, item.employee, "delete"))) return res.status(403).json({ error: "Forbidden" });
    await DoctorEntryItem.deleteOne({ _id: item._id });
    await cleanupSummary(item.employee, item.period);
    await recalculateForPeriod(item.employee, item.period);
    res.json({ success: true });
  } catch (err) {
    console.error("my-entries delete failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
