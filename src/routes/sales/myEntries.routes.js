// "Entered prescriptions" — a rep sees, edits and deletes the doctor
// prescription lines they entered on "Prescription entry".
//   GET    /api/my-entries?period=MM/YYYY[&employee=]   -> lines of that month
//   PUT    /api/my-entries/:id   { quota, prescription } -> fix one line
//   DELETE /api/my-entries/:id                          -> delete one line
//   DELETE /api/my-entries/doctor/:doctorId?period=&employee= -> all lines of a doctor
// Own lines: anyone who may enter prescriptions (sales add). Someone else's
// lines: only managers who see that employee and have sales update / delete.
import express from "express";
import mongoose from "mongoose";
import Doctor from "../../models/Doctor.js";
import Employee from "../../models/Employee.js";
import Drug from "../../models/Drug.js";
import Hospital from "../../models/Hospital.js";
import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import DoctorEntrySummary from "../../models/DoctorEntrySummary.js";
import { employeeFromRequest } from "../../middleware/authEmployee.js";
import { canSeeEmployee, getScopeEmployeeIds } from "../../utils/groupVisibility.js";
import { recalculateForPeriod } from "./doctorEntryItems.controller.js";
import { moveEntries } from "../../utils/moveEntries.js";

const router = express.Router();

// the bonus of each line is shown only to group / division managers (and admin / director)
function rowFields(req) {
  const r = (req.employee?.role?.name || "").toLowerCase().trim();
  const manager = /(group|division) manager/.test(r) || ["admin", "director"].includes(r);
  return "employee doctor drug hospital quota prescription updatedAt" + (manager ? " budget" : "");
}

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

// rebuild the month's per-drug totals from the lines that are left
// (it used to only drop drugs with no lines, so deleting/editing left a too-big total)
async function cleanupSummary(employee, period) {
  const items = await DoctorEntryItem.find({ employee, period }).select("drug prescription").lean();
  const by = new Map();
  items.forEach((i) => by.set(String(i.drug), (by.get(String(i.drug)) || 0) + (i.prescription || 0)));
  await DoctorEntrySummary.deleteMany({ employee, period, drug: { $nin: [...by.keys()] } });
  await Promise.all([...by].map(([drug, prescription]) =>
    DoctorEntrySummary.updateOne({ employee, period, drug }, { $set: { prescription } }, { upsert: true })));
}

router.get("/", async (req, res) => {
  try {
    const period = monthStart(req.query.period);
    if (!period) return res.status(400).json({ error: "period must be MM/YYYY" });
    // allMode: ?employee=all -> everyone the requester may see
    // (admin / director: all; division & product manager: their division;
    //  group manager: their group; a representative: only themselves)
    const allMode = req.query.employee === "all";
    let employee;
    if (allMode) {
      const isRep = (req.employee?.role?.name || "").toLowerCase().trim() === "representative";
      const scope = isRep ? [req.employee._id] : await getScopeEmployeeIds(req.employee);
      employee = scope ? { $in: scope } : { $exists: true };
    } else {
      employee = req.query.employee || req.employee._id;
      if (!(await canSeeEmployee(req.employee, employee))) return res.status(403).json({ error: "Forbidden" });
    }
    if (req.query.page) return pagedList(req, res, { employee, period });
    const items = await DoctorEntryItem.find({ employee, period })
      .select(rowFields(req))
      .populate("employee", "firstName lastName")
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

// pagedList: ?page=&limit=15&search= -> one page of employee+doctor cards
// (sorted by employee, then doctor) + totals for the whole month
const OID = (v) => new mongoose.Types.ObjectId(String(v));
const escRx = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fullName = (p) => ({ $toLower: { $concat: [
  { $ifNull: [{ $arrayElemAt: [`$${p}.firstName`, 0] }, ""] }, " ",
  { $ifNull: [{ $arrayElemAt: [`$${p}.lastName`, 0] }, ""] },
] } });

async function pagedList(req, res, { employee, period }) {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 15, 1), 100);
  const match = { period };
  if (employee && employee.$in) match.employee = { $in: employee.$in.map(OID) };
  else if (!(employee && employee.$exists)) match.employee = OID(employee);

  // every typed word must match the doctor, employee, drug or hospital
  const words = String(req.query.search || "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length) {
    match.$and = await Promise.all(words.map(async (w) => {
      const rx = new RegExp(escRx(w), "i");
      const [docs, emps, drugs, hosps] = await Promise.all([
        Doctor.find({ $or: [{ firstName: rx }, { lastName: rx }, { uniqueNumber: rx }] }).distinct("_id"),
        Employee.find({ $or: [{ firstName: rx }, { lastName: rx }] }).distinct("_id"),
        Drug.find({ name: rx }).distinct("_id"),
        Hospital.find({ name: rx }).distinct("_id"),
      ]);
      return { $or: [{ doctor: { $in: docs } }, { employee: { $in: emps } }, { drug: { $in: drugs } }, { hospital: { $in: hosps } }] };
    }));
  }

  const [agg] = await DoctorEntryItem.aggregate([
    { $match: match },
    { $group: { _id: { e: "$employee", d: "$doctor" }, lines: { $sum: 1 }, rx: { $sum: "$prescription" } } },
    { $lookup: { from: Doctor.collection.name, localField: "_id.d", foreignField: "_id", as: "doc" } },
    { $lookup: { from: Employee.collection.name, localField: "_id.e", foreignField: "_id", as: "emp" } },
    { $addFields: { dn: fullName("doc"), en: fullName("emp") } },
    { $sort: { en: 1, dn: 1, "_id.d": 1 } },
    { $facet: {
      page: [{ $skip: (page - 1) * limit }, { $limit: limit }, { $project: { _id: 1 } }],
      totals: [{ $group: { _id: null, groups: { $sum: 1 }, lines: { $sum: "$lines" }, rx: { $sum: "$rx" }, emps: { $addToSet: "$_id.e" } } }],
    } },
  ]);
  const t = agg?.totals?.[0] || { groups: 0, lines: 0, rx: 0, emps: [] };
  const keys = (agg?.page || []).map((p) => p._id);
  const items = keys.length
    ? await DoctorEntryItem.find({ ...match, $or: keys.map((k) => ({ employee: k.e, doctor: k.d })) })
        .select(rowFields(req))
        .populate("employee", "firstName lastName")
        .populate("doctor", "firstName lastName")
        .populate("drug", "name")
        .populate("hospital", "name")
        .lean()
    : [];
  res.json({
    items,
    order: keys.map((k) => `${k.e}|${k.d}`),
    page,
    pages: Math.max(Math.ceil(t.groups / limit), 1),
    totals: { doctors: t.groups, lines: t.lines, rx: t.rx, employees: (t.emps || []).length },
  });
}

// POST /api/my-entries/move { employee?, doctor?, from: "MM/YYYY", to: "MM/YYYY" }
// moves a doctor's lines (or all lines of the month) to another month
router.post("/move", async (req, res) => {
  try {
    const parse = (p) => { const m = String(p || "").match(/^(\d{1,2})\/(\d{4})$/); return m ? { y: +m[2], m: +m[1] } : null; };
    const from = parse(req.body.from), to = parse(req.body.to);
    if (!from || !to) return res.status(400).json({ error: "from / to must be MM/YYYY" });
    if (from.y === to.y && from.m === to.m) return res.status(400).json({ error: "same month" });
    const employee = req.body.employee || req.employee._id;
    if (!(await mayChange(req.employee, employee, "update"))) return res.status(403).json({ error: "Forbidden" });
    const r = await moveEntries({ employee, doctor: req.body.doctor || null, from, to });
    res.json({ moved: r.moved, clashes: r.clashes.length });
  } catch (err) {
    console.error("my-entries move failed:", err);
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
    await cleanupSummary(item.employee, item.period);
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

// PUT /api/my-entries/:id/bonus  { value }   — a manager changes the bonus of ONE line.
// Saved as this doctor's own bonus for this drug and month (the same record the Bonuses page
// shows under "doctors"). Only the side of the line's rep changes: a Tbilisi rep's line -> the
// doctor's Tbilisi bonus, a region rep's line -> the doctor's region bonus. The drug's general
// bonus and other doctors are not touched. Empty value -> back to the drug's bonus.
router.put("/:id/bonus", async (req, res) => {
  try {
    const role = (req.employee?.role?.name || "").toLowerCase().trim();
    if (!(/(group|division) manager/.test(role) || ["admin", "director"].includes(role))) {
      return res.status(403).json({ error: "ბონუსის შეცვლა მხოლოდ მენეჯერს შეუძლია" });
    }
    const item = await DoctorEntryItem.findById(req.params.id).select("employee doctor drug period").lean();
    if (!item) return res.status(404).json({ error: "Entry not found" });
    if (!(await canSeeEmployee(req.employee, item.employee))) return res.status(403).json({ error: "Forbidden" });
    const { seesEverything, getVisibleDrugIds } = await import("../../utils/groupVisibility.js");
    if (role !== "admin" && !seesEverything(req.employee)) {
      const mine = new Set((await getVisibleDrugIds(req.employee)).map(String));
      if (!mine.has(String(item.drug))) return res.status(403).json({ error: "ეს მედიკამენტი თქვენს დივიზიონს არ ეკუთვნის" });
    }

    const raw = req.body?.value;
    const empty = raw === null || raw === undefined || String(raw).trim() === "";
    const v = empty ? null : Math.round(Number(String(raw).replace(",", ".")) * 100) / 100;
    if (!empty && (!Number.isFinite(v) || v < 0)) return res.status(400).json({ error: "ბონუსი უნდა იყოს 0 ან მეტი რიცხვი" });

    const B = await import("../../utils/bonuses.js");
    const { default: DoctorDrugBonus } = await import("../../models/DoctorDrugBonus.js");
    const month = B.parseMonth(item.period);
    const area = await B.employeeArea(item.employee);
    // the drug's own bonus this month (what applies without a doctor bonus), both sides
    const [dt, dr] = await Promise.all([B.drugBonuses(month, [item.drug], "tbilisi"), B.drugBonuses(month, [item.drug], "region")]);
    const drugTb = dt.get(String(item.drug))?.value ?? 0;
    const drugRg = dr.get(String(item.drug))?.value ?? drugTb;

    const cur = await DoctorDrugBonus.findOne({ doctor: item.doctor, drug: item.drug, period: B.monthWindow(month) }).lean();
    // today's doctor bonus on each side (or the drug's when the doctor has none)
    let tb = cur ? cur.value : drugTb;
    let rg = cur ? (cur.regionValue ?? cur.value) : drugRg;
    if (area === "region") rg = empty ? drugRg : v;
    else tb = empty ? drugTb : v;

    await DoctorDrugBonus.deleteMany({ doctor: item.doctor, drug: item.drug, period: B.monthWindow(month) });
    if (tb !== drugTb || rg !== drugRg) {
      // the other side is written out as it was, so it does not move with this change
      await DoctorDrugBonus.create({ doctor: item.doctor, drug: item.drug, period: B.monthStart(month), value: tb, regionValue: rg, setBy: req.employee._id });
    }
    const r = await B.restampBonuses(month, { drug: item.drug, doctor: item.doctor });
    const fresh = await DoctorEntryItem.findById(item._id).select("budget").lean();
    res.json({ _id: item._id, budget: fresh?.budget ?? 0, doctor: String(item.doctor), drug: String(item.drug), recalculated: r.changed });
  } catch (err) {
    console.error("my-entries bonus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
