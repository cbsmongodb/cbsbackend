import LeaveEntry from "../../models/LeaveEntry.js";
import RestDay from "../../models/RestDay.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";
import Section from "../../models/Section.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";

// Monthly leave report for payroll: per employee, how many PAID / UNPAID /
// SICK days fall into the chosen month, grouped by division. Approved leave
// only; requests still waiting for a decision are shown separately.

const TYPES = ["paid", "unpaid", "sick"];
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

function daysOf(entry) {
  if (entry.days?.length) return entry.days.map((d) => ({ date: dayKey(d.date), type: d.type }));
  // older entries added by an admin: every working day of the range, one type
  const out = [];
  if (!TYPES.includes(entry.type)) return out;
  for (let d = new Date(dayKey(entry.startDate)); d <= new Date(dayKey(entry.endDate)); d = new Date(d.getTime() + 86400000)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push({ date: dayKey(d), type: entry.type });
  }
  return out;
}

function monthRange(month) {
  const m = String(month || "").match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  const y = m ? +m[1] : now.getFullYear();
  const mo = m ? +m[2] - 1 : now.getMonth();
  return { key: `${y}-${String(mo + 1).padStart(2, "0")}`, from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1) - 1) };
}

// GET /api/reports/leave-payroll/divisions
export async function getLeavePayrollDivisions(req, res) {
  try {
    res.json(await Section.find({}).sort({ name: 1 }).select("name").lean());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/reports/leave-payroll?month=YYYY-MM&division=<sectionId>
export async function getLeavePayrollReport(req, res) {
  try {
    const { key, from, to } = monthRange(req.query.month);
    const filter = { startDate: { $lte: to }, endDate: { $gte: from }, status: { $in: ["approved", "pending", null] } };

    // a division manager only sees his own division
    const scope = await getScopeEmployeeIds(req.employee);
    if (scope) filter.employee = { $in: scope };

    const [entries, restDays] = await Promise.all([
      LeaveEntry.find(filter).select("employee type startDate endDate days status").lean(),
      RestDay.find({ date: { $gte: new Date(from.getTime() - 86400000), $lte: to } }).select("date").lean(),
    ]);
    const restKeys = new Set(restDays.map((r) => dayKey(new Date(r.date.getTime() + 12 * 3600e3))));
    const fromKey = dayKey(from), toKey = dayKey(to);

    const byEmp = new Map();
    for (const e of entries) {
      const id = String(e.employee);
      if (!byEmp.has(id)) byEmp.set(id, { paid: [], unpaid: [], sick: [], pending: [] });
      const row = byEmp.get(id);
      const pending = e.status === "pending";
      for (const d of daysOf(e)) {
        if (d.date < fromKey || d.date > toKey || restKeys.has(d.date)) continue;
        if (pending) row.pending.push({ date: d.date, type: d.type });
        else row[d.type].push(d.date);
      }
    }
    for (const [id, r] of byEmp) {
      if (!r.paid.length && !r.unpaid.length && !r.sick.length && !r.pending.length) byEmp.delete(id);
    }

    const employees = await Employee.find({ _id: { $in: [...byEmp.keys()] } }).select("firstName lastName group isActive").lean();
    const groups = await Group.find({ _id: { $in: employees.map((e) => e.group).filter(Boolean) } }).select("section").lean();
    const sections = await Section.find({}).select("name head").lean();
    const sectionById = new Map(sections.map((s) => [String(s._id), s]));
    const sectionByHead = new Map(sections.filter((s) => s.head).map((s) => [String(s.head), s]));
    const groupSection = new Map(groups.map((g) => [String(g._id), g.section ? String(g.section) : null]));

    const divisions = new Map();
    for (const emp of employees) {
      const secId = groupSection.get(String(emp.group)) || (sectionByHead.get(String(emp._id))?._id ? String(sectionByHead.get(String(emp._id))._id) : null);
      if (req.query.division && secId !== String(req.query.division)) continue;
      const sec = secId ? sectionById.get(secId) : null;
      const dKey = sec ? String(sec._id) : "none";
      if (!divisions.has(dKey)) divisions.set(dKey, { _id: sec?._id || null, name: sec?.name || "", rows: [] });
      const r = byEmp.get(String(emp._id));
      const sort = (a) => [...a].sort();
      divisions.get(dKey).rows.push({
        employeeId: emp._id,
        employeeName: `${emp.firstName || ""} ${emp.lastName || ""}`.trim(),
        isActive: emp.isActive !== false,
        paid: r.paid.length,
        unpaid: r.unpaid.length,
        sick: r.sick.length,
        paidDates: sort(r.paid),
        unpaidDates: sort(r.unpaid),
        sickDates: sort(r.sick),
        pending: r.pending.sort((a, b) => a.date.localeCompare(b.date)),
      });
    }

    const list = [...divisions.values()]
      .map((d) => {
        d.rows.sort((a, b) => b.unpaid - a.unpaid || b.sick - a.sick || a.employeeName.localeCompare(b.employeeName));
        d.totals = d.rows.reduce((t, r) => ({ paid: t.paid + r.paid, unpaid: t.unpaid + r.unpaid, sick: t.sick + r.sick }), { paid: 0, unpaid: 0, sick: 0 });
        return d;
      })
      .sort((a, b) => (a._id ? 0 : 1) - (b._id ? 0 : 1) || a.name.localeCompare(b.name));

    res.json({ month: key, divisions: list });
  } catch (err) {
    console.error("getLeavePayrollReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
