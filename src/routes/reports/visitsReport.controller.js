// Visits list report — who visited where, when, and which doctors.
//   GET /api/reports/visits/divisions
//   GET /api/reports/visits?from=YYYY-MM-DD&to=YYYY-MM-DD[&division=][&employee=][&status=done|planned|canceled]
// Division / group managers only see their own people (getScopeEmployeeIds).
import PlanConfiguration from "../../models/PlanConfiguration.js";
import PlanConfigurationDoctor from "../../models/PlanConfigurationDoctor.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";
import Section from "../../models/Section.js";
import "../../models/Hospital.js";
import "../../models/Pharmacy.js";
import "../../models/Doctor.js";
import "../../models/Profile.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";
import { divisionEmployeeIds } from "./reports.controller.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const MAX_DAYS = 93;
const STATUS_GROUPS = {
  done: ["completed", "i_left", "i_went"],
  planned: ["planned"],
  canceled: ["canceled"],
};

export async function getVisitsDivisions(req, res) {
  try {
    res.json(await Section.find({ name: /DIVIZION/i }).sort({ name: 1 }).select("name").lean());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getVisitsReport(req, res) {
  try {
    const { from, to, division, employee, status } = req.query;
    if (!isDay(from) || !isDay(to) || from > to) return res.status(400).json({ error: "from / to dates are required" });
    const start = new Date(`${from}T00:00:00+04:00`);
    const end = new Date(`${to}T23:59:59.999+04:00`);
    if ((end - start) / 86400000 > MAX_DAYS) return res.status(400).json({ error: `At most ${MAX_DAYS} days at once` });

    const filter = { period: { $gte: start, $lte: end } };
    if (STATUS_GROUPS[status]) filter.status = { $in: STATUS_GROUPS[status] };

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

    // doctors of every visit
    const docs = plans.length
      ? await PlanConfigurationDoctor.find({ planConfiguration: { $in: plans.map((p) => p._id) } })
        .select("planConfiguration doctor")
        .populate({ path: "doctor", select: "firstName lastName profile", populate: { path: "profile", select: "name" } })
        .lean()
      : [];
    const doctorsByPlan = new Map();
    for (const d of docs) {
      if (!d.doctor) continue;
      const k = String(d.planConfiguration);
      if (!doctorsByPlan.has(k)) doctorsByPlan.set(k, []);
      doctorsByPlan.get(k).push({
        name: `${d.doctor.firstName || ""} ${d.doctor.lastName || ""}`.trim(),
        profile: d.doctor.profile?.name || "",
      });
    }

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
        doctors: doctorsByPlan.get(String(p._id)) || [],
        comment: p.comment || "",
      };
    });

    res.json({ from, to, visits });
  } catch (err) {
    console.error("getVisitsReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
