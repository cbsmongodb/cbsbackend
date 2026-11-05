// Visits list report — where each employee had completed visits, and when.
//   GET /api/reports/visits/divisions
//   GET /api/reports/visits?from=YYYY-MM-DD&to=YYYY-MM-DD[&division=][&employee=]   (completed visits only)
// Division / group managers only see their own people (getScopeEmployeeIds).
import PlanConfiguration from "../../models/PlanConfiguration.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";
import Section from "../../models/Section.js";
import "../../models/Hospital.js";
import "../../models/Pharmacy.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";
import { divisionEmployeeIds } from "./reports.controller.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const MAX_DAYS = 93;
const STATUS_GROUPS = {
  done: ["completed", "i_left", "i_went"],
  planned: ["planned"],
  canceled: ["canceled"],
};

// divisions shown as filter buttons — a division / group manager only gets their own
export async function getVisitsDivisions(req, res) {
  try {
    const all = await Section.find({ name: /DIVIZION/i }).sort({ name: 1 }).select("name head").lean();
    const scope = await getScopeEmployeeIds(req.employee);
    if (!scope) return res.json(all.map(({ _id, name }) => ({ _id, name })));
    const emps = await Employee.find({ _id: { $in: scope } }).select("group").lean();
    const groups = await Group.find({ _id: { $in: emps.map((e) => e.group).filter(Boolean) } }).select("section").lean();
    const mine = new Set(groups.map((g) => String(g.section)).filter(Boolean));
    all.forEach((s) => { if (s.head && scope.map(String).includes(String(s.head))) mine.add(String(s._id)); });
    res.json(all.filter((s) => mine.has(String(s._id))).map(({ _id, name }) => ({ _id, name })));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

// employees for the filter dropdown — only the people this user may see
export async function getVisitsEmployees(req, res) {
  try {
    const scope = await getScopeEmployeeIds(req.employee);
    const q = scope ? { _id: { $in: scope } } : { isActive: { $ne: false } };
    const list = await Employee.find(q).select("firstName lastName").sort({ firstName: 1, lastName: 1 }).lean();
    res.json(list.map((e) => ({ _id: e._id, name: `${e.firstName || ""} ${e.lastName || ""}`.trim() })));
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getVisitsReport(req, res) {
  try {
    const { from, to, division, employee } = req.query;
    if (!isDay(from) || !isDay(to) || from > to) return res.status(400).json({ error: "from / to dates are required" });
    const start = new Date(`${from}T00:00:00+04:00`);
    const end = new Date(`${to}T23:59:59.999+04:00`);
    if ((end - start) / 86400000 > MAX_DAYS) return res.status(400).json({ error: `At most ${MAX_DAYS} days at once` });

    // completed visits only
    const filter = { period: { $gte: start, $lte: end }, status: { $in: STATUS_GROUPS.done } };

    let ids = null; // null = everyone
    const scope = await getScopeEmployeeIds(req.employee);
    if (scope) ids = scope.map(String);
    if (employee) ids = ids ? ids.filter((x) => x === String(employee)) : [String(employee)];
    if (division) {
      const d = new Set(await divisionEmployeeIds(division));
      ids = ids ? ids.filter((x) => d.has(x)) : [...d];
    }
    if (ids) filter.performer = { $in: ids };

    const plans = await PlanConfiguration.find(filter)
      .populate("performer", "firstName lastName group")
      .populate("hospital", "name")
      .populate("pharmacy", "pharmacyName")
      .select("planNumber planType period status iWentAt iLeftAt comment performer hospital pharmacy")
      .sort({ period: -1 })
      .lean();

    // employee -> division name
    const groupIds = [...new Set(plans.map((p) => p.performer?.group).filter(Boolean).map(String))];
    const groups = groupIds.length ? await Group.find({ _id: { $in: groupIds } }).select("section").lean() : [];
    const sections = await Section.find({}).select("name head").lean();
    const sectionById = new Map(sections.map((s) => [String(s._id), s]));
    const sectionByHead = new Map(sections.filter((s) => s.head).map((s) => [String(s.head), s]));
    const groupSection = new Map(groups.map((g) => [String(g._id), g.section ? String(g.section) : null]));
    const divisionOf = (emp) => {
      if (!emp) return null;
      const sid = groupSection.get(String(emp.group)) || (sectionByHead.get(String(emp._id)) ? String(sectionByHead.get(String(emp._id))._id) : null);
      return sid ? sectionById.get(sid) : null;
    };

    const visits = plans.map((p) => {
      const sec = divisionOf(p.performer);
      return {
        _id: p._id,
        planNumber: p.planNumber || "",
        planType: p.planType,
        date: p.period,
        status: p.status,
        iWentAt: p.iWentAt || null,
        iLeftAt: p.iLeftAt || null,
        employeeId: p.performer?._id || null,
        employeeName: p.performer ? `${p.performer.firstName || ""} ${p.performer.lastName || ""}`.trim() : "",
        divisionId: sec?._id || null,
        divisionName: sec?.name || "",
        placeType: p.hospital ? "hospital" : p.pharmacy ? "pharmacy" : "",
        place: p.hospital?.name || p.pharmacy?.pharmacyName || "",
      };
    });

    // one row = one employee on one day (Georgian date); newest day first, then by name
    const gDay = (d) => new Date(+new Date(d) + 4 * 3600e3).toISOString().slice(0, 10);
    const byRow = new Map();
    for (const x of visits) {
      const day = gDay(x.iWentAt || x.date);
      const k = `${day}_${x.employeeId}`;
      if (!byRow.has(k)) byRow.set(k, { day, employeeId: x.employeeId, employeeName: x.employeeName, divisionName: x.divisionName, visits: [] });
      byRow.get(k).visits.push(x);
    }
    const rows = [...byRow.values()]
      .map((r) => ({ ...r, visits: r.visits.sort((a, b) => new Date(a.iWentAt || a.date) - new Date(b.iWentAt || b.date)) }))
      .sort((a, b) => b.day.localeCompare(a.day) || a.employeeName.localeCompare(b.employeeName));

    const all = req.query.all === "1"; // Excel: everything at once
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
    const pages = Math.max(1, Math.ceil(rows.length / limit));
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), pages);
    res.json({
      from, to, total: rows.length, totalVisits: visits.length,
      page: all ? 1 : page, pages: all ? 1 : pages, limit: all ? rows.length : limit,
      rows: all ? rows : rows.slice((page - 1) * limit, page * limit),
    });
  } catch (err) {
    console.error("getVisitsReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
