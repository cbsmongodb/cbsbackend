import LeaveEntry from "../../models/LeaveEntry.js";
import LeaveBalance from "../../models/LeaveBalance.js";
import RestDay from "../../models/RestDay.js";
import Employee from "../../models/Employee.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";

// who can approve / reject and see the archive
const APPROVER_ROLES = new Set(["admin", "director", "division manager"]);
export const canApprove = (emp) => APPROVER_ROLES.has((emp?.role?.name || "").toLowerCase().trim());

// admin / director decide for everyone; a division manager only for his own people, never for himself
const GLOBAL_APPROVERS = new Set(["admin", "director"]);
async function approverScope(emp) {
  if (GLOBAL_APPROVERS.has((emp?.role?.name || "").toLowerCase().trim())) return null;
  const ids = (await getScopeEmployeeIds(emp)) || [];
  return ids.filter((id) => String(id) !== String(emp._id));
}
async function inScope(emp, employeeId) {
  if (!canApprove(emp)) return false;
  const scope = await approverScope(emp);
  return !scope || scope.map(String).includes(String(employeeId?._id || employeeId));
}

const TYPES = ["paid", "unpaid", "sick"];
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const toDay = (str) => new Date(`${String(str).slice(0, 10)}T00:00:00.000Z`);
const yearRange = (y) => [new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y, 11, 31, 23, 59, 59))];

function daysOf(entry) {
  if (entry.days?.length) return entry.days.map((d) => ({ date: dayKey(d.date), type: d.type }));
  // old admin entries: every day of the range, one type
  const out = [];
  if (!TYPES.includes(entry.type)) return out;
  for (let d = new Date(dayKey(entry.startDate)); d <= new Date(dayKey(entry.endDate)); d = new Date(d.getTime() + 86400000)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push({ date: dayKey(d), type: entry.type });
  }
  return out;
}

async function summaryFor(employeeId, year) {
  const bal = await LeaveBalance.findOne({ employee: employeeId, year });
  const total = bal?.paidDaysTotal ?? 24;
  const [from, to] = yearRange(year);
  const entries = await LeaveEntry.find({ employee: employeeId, startDate: { $gte: from, $lte: to } });
  const used = { paid: 0, unpaid: 0, sick: 0 };
  const pending = { paid: 0, unpaid: 0, sick: 0 };
  entries.forEach((e) => {
    const st = e.status || "approved";
    if (st !== "approved" && st !== "pending") return;
    daysOf(e).forEach((d) => { (st === "approved" ? used : pending)[d.type] += 1; });
  });
  return { year, paidTotal: total, used, pending, paidRemaining: total - used.paid };
}

const populate = (q) => q.populate("employee", "firstName lastName email").populate("decidedBy", "firstName lastName");

// GET /api/leave-requests/mine?year=
export async function getMine(req, res) {
  try {
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const [from, to] = yearRange(year);
    const requests = await populate(LeaveEntry.find({ employee: req.employee._id, startDate: { $gte: from, $lte: to } }).sort({ startDate: -1 }));
    res.json({ summary: await summaryFor(req.employee._id, year), requests, canApprove: canApprove(req.employee) });
  } catch (err) {
    console.error("leave getMine failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/leave-requests/rest-days?year=  (holidays, so the calendar can grey them out)
export async function getRestDaysForYear(req, res) {
  try {
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const [from, to] = yearRange(year);
    const rows = await RestDay.find({ date: { $gte: new Date(from.getTime() - 86400000), $lte: to } }).select("date label");
    res.json(rows.map((r) => ({ date: dayKey(new Date(r.date.getTime() + 12 * 3600e3)), label: r.label || "" })));
  } catch (err) {
    console.error("leave rest days failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/leave-requests  { days: [{ date: "YYYY-MM-DD", type }], note }
export async function createRequest(req, res) {
  try {
    const raw = Array.isArray(req.body?.days) ? req.body.days : [];
    const note = String(req.body?.note || "").slice(0, 500);
    const seen = new Set();
    let days = [];
    for (const d of raw) {
      const key = String(d?.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !TYPES.includes(d?.type) || seen.has(key)) continue;
      const wd = toDay(key).getUTCDay();
      if (wd === 0 || wd === 6) continue; // weekends are not leave days
      seen.add(key);
      days.push({ date: toDay(key), type: d.type });
    }
    if (!days.length) return res.status(400).json({ error: "Choose at least one working day" });
    const firstDay = new Date(Math.min(...days.map((d) => d.date.getTime())) - 86400000);
    const restKeys = new Set((await RestDay.find({ date: { $gte: firstDay } }).select("date"))
      .map((r) => dayKey(new Date(r.date.getTime() + 12 * 3600e3))));
    days = days.filter((d) => !restKeys.has(dayKey(d.date)));
    if (!days.length) return res.status(400).json({ error: "Choose at least one working day" });
    days.sort((a, b) => a.date - b.date);

    const years = new Set(days.map((d) => d.date.getUTCFullYear()));
    if (years.size > 1) return res.status(400).json({ error: "One request can only cover one year" });
    const year = [...years][0];

    // no overlap with my other pending / approved days
    const [from, to] = yearRange(year);
    const mine = await LeaveEntry.find({ employee: req.employee._id, startDate: { $gte: from, $lte: to }, status: { $in: ["pending", "approved", null] } });
    const taken = new Set(mine.flatMap((e) => daysOf(e).map((d) => d.date)));
    const clash = days.find((d) => taken.has(dayKey(d.date)));
    if (clash) return res.status(400).json({ error: `${dayKey(clash.date)} is already requested` });

    // paid days: approved + pending + this one must fit the yearly allowance
    const sum = await summaryFor(req.employee._id, year);
    const newPaid = days.filter((d) => d.type === "paid").length;
    if (newPaid && sum.used.paid + sum.pending.paid + newPaid > sum.paidTotal) {
      return res.status(400).json({ error: `Not enough paid leave: ${sum.paidTotal - sum.used.paid - sum.pending.paid} days left` });
    }

    const types = new Set(days.map((d) => d.type));
    const entry = await LeaveEntry.create({
      employee: req.employee._id,
      type: types.size === 1 ? [...types][0] : "mixed",
      startDate: days[0].date,
      endDate: days[days.length - 1].date,
      daysCount: days.length,
      days,
      note,
      status: "pending",
      createdBy: req.employee._id,
    });
    res.status(201).json(await populate(LeaveEntry.findById(entry._id)));
  } catch (err) {
    console.error("leave createRequest failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// DELETE /api/leave-requests/:id  -> cancel my own pending request (approvers: any request)
export async function cancelRequest(req, res) {
  try {
    const e = await LeaveEntry.findById(req.params.id);
    if (!e) return res.status(404).json({ error: "Not found" });
    const own = String(e.employee) === String(req.employee._id);
    if (!(own && e.status === "pending") && !(await inScope(req.employee, e.employee))) return res.status(403).json({ error: "Not allowed" });
    e.status = "canceled";
    e.decidedBy = req.employee._id;
    e.decidedAt = new Date();
    await e.save();
    res.json({ success: true });
  } catch (err) {
    console.error("leave cancel failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/leave-requests/pending  (approvers)
export async function getPending(req, res) {
  try {
    if (!canApprove(req.employee)) return res.status(403).json({ error: "Not allowed" });
    const scope = await approverScope(req.employee);
    const pf = { status: "pending" };
    if (scope) pf.employee = { $in: scope };
    const rows = await populate(LeaveEntry.find(pf).sort({ createdAt: 1 }));
    const out = [];
    for (const r of rows) {
      const year = new Date(r.startDate).getUTCFullYear();
      out.push({ ...r.toObject(), summary: await summaryFor(r.employee?._id, year) });
    }
    res.json(out);
  } catch (err) {
    console.error("leave getPending failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

async function decide(req, res, status) {
  try {
    if (!canApprove(req.employee)) return res.status(403).json({ error: "Not allowed" });
    const e = await LeaveEntry.findById(req.params.id);
    if (!e) return res.status(404).json({ error: "Not found" });
    if (!(await inScope(req.employee, e.employee))) return res.status(403).json({ error: "Not allowed" });
    if (e.status !== "pending") return res.status(400).json({ error: "Already decided" });
    if (status === "approved") {
      const year = new Date(e.startDate).getUTCFullYear();
      const sum = await summaryFor(e.employee, year);
      const paid = daysOf(e).filter((d) => d.type === "paid").length;
      if (paid && sum.used.paid + paid > sum.paidTotal) {
        return res.status(400).json({ error: `Not enough paid leave: ${sum.paidTotal - sum.used.paid} days left` });
      }
    }
    e.status = status;
    e.decidedBy = req.employee._id;
    e.decidedAt = new Date();
    e.decisionNote = String(req.body?.note || "").slice(0, 500);
    await e.save();
    res.json(await populate(LeaveEntry.findById(e._id)));
  } catch (err) {
    console.error("leave decide failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
export const approveRequest = (req, res) => decide(req, res, "approved");
export const rejectRequest = (req, res) => decide(req, res, "rejected");

// GET /api/leave-requests/archive?year=  (approvers): per person totals + every request
export async function getArchive(req, res) {
  try {
    if (!canApprove(req.employee)) return res.status(403).json({ error: "Not allowed" });
    const year = Number(req.query.year) || new Date().getUTCFullYear();
    const [from, to] = yearRange(year);
    const scope = await approverScope(req.employee);
    const rf = { startDate: { $gte: from, $lte: to } };
    if (scope) rf.employee = { $in: scope };
    const requests = await populate(LeaveEntry.find(rf).sort({ startDate: -1 }));
    const balances = new Map((await LeaveBalance.find({ year })).map((b) => [String(b.employee), b.paidDaysTotal]));
    const people = new Map();
    const employees = await Employee.find({ isActive: { $ne: false }, ...(scope ? { _id: { $in: scope } } : {}) }).select("firstName lastName");
    employees.forEach((e) => people.set(String(e._id), {
      employee: { _id: e._id, firstName: e.firstName, lastName: e.lastName },
      paidTotal: balances.get(String(e._id)) ?? 24,
      used: { paid: 0, unpaid: 0, sick: 0 }, pending: 0,
    }));
    requests.forEach((r) => {
      const id = String(r.employee?._id || "");
      if (!people.has(id)) people.set(id, { employee: r.employee, paidTotal: balances.get(id) ?? 24, used: { paid: 0, unpaid: 0, sick: 0 }, pending: 0 });
      const p = people.get(id);
      const st = r.status || "approved";
      if (st === "pending") p.pending += 1;
      if (st === "approved") daysOf(r).forEach((d) => { p.used[d.type] += 1; });
    });
    const summary = [...people.values()].map((p) => ({ ...p, paidRemaining: p.paidTotal - p.used.paid }))
      .sort((a, b) => `${a.employee?.firstName} ${a.employee?.lastName}`.localeCompare(`${b.employee?.firstName} ${b.employee?.lastName}`));
    res.json({ year, summary, requests });
  } catch (err) {
    console.error("leave getArchive failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
