import EmployeeSale from "../../models/EmployeeSale.js";
import { nameSearchFilter } from "../../utils/nameSearch.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import Employee from "../../models/Employee.js";
import { getVisibleDrugIds, seesEverything, getScopeEmployeeIds } from "../../utils/groupVisibility.js";
import Group from "../../models/Group.js";
import Section from "../../models/Section.js";
import { parseMonth, monthWindow } from "../../utils/bonuses.js";
const FORBIDDEN = { error: "ეს თანამშრომელი თქვენს დივიზიონს არ ეკუთვნის" };

// Employee sales are shared inside a division: everyone in a division sees the
// sales of every person in that division (admin, director, finance... see all).
// null = no limit. Someone not linked to any division sees what they saw before.
export async function divisionEmployeeIds(me) {
  if (seesEverything(me)) return null;
  // a Group Manager sees only their OWN group, not the whole division
  const roleName = (me?.role?.name || "").toLowerCase().trim();
  if (roleName === "group manager" || roleName.startsWith("group manager ")) return getScopeEmployeeIds(me);
  const myGroups = [];
  if (me.group) myGroups.push(me.group?._id || me.group);
  const ledOrMember = await Group.find({ $or: [{ head: me._id }, { members: me._id }] }).select("_id").lean();
  ledOrMember.forEach((g) => myGroups.push(g._id));

  const secIds = new Set();
  const secs1 = await Section.find({ $or: [{ head: me._id }, { groups: { $in: myGroups } }] }).select("_id").lean();
  secs1.forEach((x) => secIds.add(String(x._id)));
  const own = await Group.find({ _id: { $in: myGroups } }).select("section").lean();
  own.forEach((g) => g.section && secIds.add(String(g.section)));
  if (!secIds.size) return getScopeEmployeeIds(me);

  const secs = await Section.find({ _id: { $in: [...secIds] } }).select("groups head").lean();
  const groups = await Group.find({
    $or: [{ section: { $in: [...secIds] } }, { _id: { $in: secs.flatMap((x) => x.groups || []) } }],
  }).select("_id head members").lean();
  const ids = new Set([String(me._id)]);
  secs.forEach((x) => x.head && ids.add(String(x.head)));
  groups.forEach((g) => {
    if (g.head) ids.add(String(g.head));
    (g.members || []).forEach((m) => ids.add(String(m)));
  });
  const people = await Employee.find({ group: { $in: groups.map((g) => g._id) } }).select("_id").lean();
  people.forEach((e) => ids.add(String(e._id)));
  return [...ids];
}

async function canSeeEmployee(me, employeeId) {
  const scope = await divisionEmployeeIds(me);
  if (!scope) return true;
  const target = String(employeeId?._id || employeeId || "");
  return scope.includes(target);
}

// GET /api/employee-sales/employees -> people of my division (for the dropdowns)
export async function getSaleEmployees(req, res) {
  try {
    const scope = await divisionEmployeeIds(req.employee);
    const filter = scope ? { _id: { $in: scope } } : {};
    const people = await Employee.find(filter).select("firstName lastName isActive").sort({ firstName: 1 }).lean();
    res.json(people);
  } catch (err) {
    console.error("getSaleEmployees failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
import Drug from "../../models/Drug.js";
import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import { recalculateForPeriod } from "../sales/doctorEntryItems.controller.js";

// refreshCoefficients: pharmacy sales decide the coefficient (real sales /
// prescriptions) on Prescription entry — so after a sale is added, changed or
// deleted, that employee's month is recalculated right away (coefficient,
// budgets, sales amounts on the Budgets page)
async function refreshCoefficients(employee, date) {
  try {
    if (!employee || !date) return;
    const H = 3600 * 1000;
    const d = new Date(new Date(date).getTime() + 4 * H);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const item = await DoctorEntryItem.findOne({
      employee,
      period: { $gte: new Date(Date.UTC(y, m, 1) - 12 * H), $lt: new Date(Date.UTC(y, m + 1, 1) - 12 * H) },
    }).select("period").lean();
    if (item) await recalculateForPeriod(employee, item.period);
  } catch (err) {
    console.error("refreshCoefficients failed:", err);
  }
}

// GET /api/employee-sales?search=&employee=&fromDate=&toDate=&page=&limit=
export async function getAllEmployeeSales(req, res) {
  try {
    const { search, employee, fromDate, toDate, month, page, limit } = req.query;

    const filter = {};
    if (employee) filter.employee = employee;
    if (fromDate && toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      filter.date = { $gte: new Date(fromDate), $lte: to };
    }
    // ?month=YYYY-MM -> that whole month (Tbilisi time)
    if (month && /^\d{4}-\d{2}$/.test(month)) filter.date = monthWindow(parseMonth(month));

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const matchingEmployees = await Employee.find(nameSearchFilter(search, ["firstName", "lastName"])).distinct("_id");
      filter.employee = filter.employee || { $in: matchingEmployees };
    }

    // division / group filter (?section= / ?group=)
    const only = await peopleOf(req.query.section, req.query.group);
    if (only) {
      const set = new Set(only);
      if (filter.employee && typeof filter.employee !== "object") { if (!set.has(String(filter.employee))) filter.employee = { $in: [] }; }
      else if (filter.employee?.$in) filter.employee = { $in: filter.employee.$in.filter((id) => set.has(String(id))) };
      else filter.employee = { $in: only };
    }

    // each division sees only its own people (admin, director, finance... see all)
    const scope = await divisionEmployeeIds(req.employee);
    if (scope) {
      const allowed = new Set(scope);
      if (filter.employee && typeof filter.employee !== "object") {
        if (!allowed.has(String(filter.employee))) filter.employee = { $in: [] };
      } else if (filter.employee?.$in) {
        filter.employee = { $in: filter.employee.$in.filter((id) => allowed.has(String(id))) };
      } else {
        filter.employee = { $in: scope };
      }
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      EmployeeSale.find(filter)
        .populate("employee", "firstName lastName")
        .populate("correctedBy", "firstName lastName")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limitNum).lean(),
      EmployeeSale.countDocuments(filter),
    ]);

    const saleIds = docs.map((d) => d._id);
    const sales = await MedicineTarget.find({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: { $in: saleIds },
    }).populate("drug", "price").lean();

    const amountBySale = new Map();
    const boxesBySale = new Map();
    sales.forEach((s) => {
      const key = String(s.medicineTargatableId);
      boxesBySale.set(key, (boxesBySale.get(key) || 0) + (s.totalNoOfBoxes || 0));
      const amount = (s.totalNoOfBoxes || 0) * (s.drug?.price || 0);
      amountBySale.set(key, (amountBySale.get(key) || 0) + amount);
    });

    const rows = docs.map((d) => ({
      _id: d._id,
      date: d.date,
      employeeName: d.employee?.name || "—",
      saleAmount: Math.round((amountBySale.get(String(d._id)) || 0) * 100) / 100,
      saleBoxes: boxesBySale.get(String(d._id)) || 0,
      correctedAmount: d.correctedAmount ?? null,
      correctionNote: d.correctionNote || "",
      correctedByName: d.correctedBy ? `${d.correctedBy.firstName || ""} ${d.correctedBy.lastName || ""}`.trim() : "",
      correctedAt: d.correctedAt || null,
    }));

    res.json({
      docs: rows,
      canCorrect: canCorrectSales(req.employee),
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAllEmployeeSales failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteEmployeeSale(req, res) {
  try {
    const own = await EmployeeSale.findById(req.params.id).select("employee").lean();
    if (!own) return res.status(404).json({ error: "Not found" });
    if (!(await canSeeEmployee(req.employee, own.employee))) return res.status(403).json(FORBIDDEN);
    await MedicineTarget.deleteMany({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: req.params.id,
    });
    const deleted = await EmployeeSale.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    await refreshCoefficients(deleted.employee, deleted.date);
    res.json({ success: true });
  } catch (err) {
    console.error("deleteEmployeeSale failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}


// GET /api/employee-sales/visible-drugs
export async function getVisibleDrugsForSale(req, res) {
  try {
    const isAdmin = seesEverything(req.employee);
    let filter = {};
    if (!isAdmin) {
      const visibleIds = await getVisibleDrugIds(req.employee);
      filter._id = { $in: visibleIds };
    }
    const drugs = await Drug.find(filter).select("name price").sort({ name: 1 }).lean();
    res.json(drugs);
  } catch (err) {
    console.error("getVisibleDrugsForSale failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/employee-sales
export async function createEmployeeSale(req, res) {
  try {
    const { employee, date, items } = req.body;
    if (!employee || !date) return res.status(400).json({ error: "employee and date are required" });
    const list = Array.isArray(items) ? items.filter((i) => i.drug && Number(i.totalNoOfBoxes) > 0) : [];
    if (list.length === 0) return res.status(400).json({ error: "at least one drug with boxes is required" });
    if (!(await canSeeEmployee(req.employee, employee))) return res.status(403).json(FORBIDDEN);

    const sale = await EmployeeSale.create({ employee, date: new Date(date) });
    const rows = list.map((i) => ({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: sale._id,
      drug: i.drug,
      totalNoOfBoxes: Number(i.totalNoOfBoxes),
    }));
    await MedicineTarget.insertMany(rows);
    await refreshCoefficients(employee, date);
    res.json({ _id: sale._id, ok: true });
  } catch (err) {
    console.error("createEmployeeSale failed:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

// GET /api/employee-sales/:id
export async function getEmployeeSaleById(req, res) {
  try {
    const sale = await EmployeeSale.findById(req.params.id).populate("employee", "firstName lastName name").lean();
    if (!sale) return res.status(404).json({ error: "Not found" });
    if (!(await canSeeEmployee(req.employee, sale.employee))) return res.status(403).json(FORBIDDEN);
    const rows = await MedicineTarget.find({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: sale._id,
    }).populate("drug", "name price").lean();
    res.json({
      _id: sale._id,
      date: sale.date,
      employee: sale.employee?._id || sale.employee,
      items: rows.map((r) => ({
        drug: r.drug?._id || r.drug,
        drugName: r.drug?.name || "",
        totalNoOfBoxes: r.totalNoOfBoxes,
      })),
    });
  } catch (err) {
    console.error("getEmployeeSaleById failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// PUT /api/employee-sales/:id
export async function updateEmployeeSale(req, res) {
  try {
    const { employee, date, items } = req.body;
    if (!employee || !date) return res.status(400).json({ error: "employee and date are required" });
    const list = Array.isArray(items) ? items.filter((i) => i.drug && Number(i.totalNoOfBoxes) > 0) : [];
    if (list.length === 0) return res.status(400).json({ error: "at least one drug with boxes is required" });

    const before = await EmployeeSale.findById(req.params.id).select("employee date").lean();
    if (!before) return res.status(404).json({ error: "Not found" });
    if (!(await canSeeEmployee(req.employee, before.employee)) || !(await canSeeEmployee(req.employee, employee))) {
      return res.status(403).json(FORBIDDEN);
    }
    const sale = await EmployeeSale.findByIdAndUpdate(req.params.id, { employee, date: new Date(date) }, { new: true });
    if (!sale) return res.status(404).json({ error: "Not found" });

    await MedicineTarget.deleteMany({ medicineTargatableType: "EmployeeSale", medicineTargatableId: sale._id });
    const rows = list.map((i) => ({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: sale._id,
      drug: i.drug,
      totalNoOfBoxes: Number(i.totalNoOfBoxes),
    }));
    await MedicineTarget.insertMany(rows);
    await refreshCoefficients(employee, date);
    if (before && (String(before.employee) !== String(employee) || +new Date(before.date) !== +new Date(date))) {
      await refreshCoefficients(before.employee, before.date);
    }
    res.json({ _id: sale._id, ok: true });
  } catch (err) {
    console.error("updateEmployeeSale failed:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

// ---- division / group filter (Employee sales page) ----
const okId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ""));
// employees of one group, or of every group of a division (+ the division head)
async function peopleOf(section, group) {
  let groupIds = [];
  let head = null;
  if (okId(group)) groupIds = [String(group)];
  else if (okId(section)) {
    const sec = await Section.findById(section).select("groups head").lean();
    const linked = await Group.find({ section }).distinct("_id");
    groupIds = [...new Set([...(sec?.groups || []).map(String), ...linked.map(String)])];
    head = sec?.head ? String(sec.head) : null;
  } else return null;
  const ids = new Set(head ? [head] : []);
  (await Employee.find({ group: { $in: groupIds } }).distinct("_id")).forEach((id) => ids.add(String(id)));
  (await Group.find({ _id: { $in: groupIds } }).select("head members").lean()).forEach((g) => {
    if (g.head) ids.add(String(g.head));
    (g.members || []).forEach((m) => ids.add(String(m)));
  });
  return [...ids];
}

// GET /api/employee-sales/filters -> the divisions / groups (and who is in each) this user may see
export async function getSaleFilters(req, res) {
  try {
    const scope = await divisionEmployeeIds(req.employee);
    const allowed = scope ? new Set(scope.map(String)) : null;
    const [sections, groups, people] = await Promise.all([
      Section.find().select("name groups head").sort({ name: 1 }).lean(),
      Group.find().select("name section head members").sort({ name: 1 }).lean(),
      Employee.find(allowed ? { _id: { $in: [...allowed] } } : {}).select("group").lean(),
    ]);
    const sectionOf = new Map();
    sections.forEach((s) => (s.groups || []).forEach((g) => sectionOf.set(String(g), String(s._id))));
    const byGroup = new Map();
    const add = (g, e) => {
      if (!g || !e || (allowed && !allowed.has(String(e)))) return;
      if (!byGroup.has(String(g))) byGroup.set(String(g), new Set());
      byGroup.get(String(g)).add(String(e));
    };
    people.forEach((p) => add(p.group, p._id));
    groups.forEach((g) => { add(g._id, g.head); (g.members || []).forEach((m) => add(g._id, m)); });
    const outGroups = groups.filter((g) => byGroup.has(String(g._id))).map((g) => ({
      id: String(g._id), name: g.name,
      section: g.section ? String(g.section) : sectionOf.get(String(g._id)) || null,
      employees: [...byGroup.get(String(g._id))],
    }));
    const used = new Set(outGroups.map((g) => g.section).filter(Boolean));
    res.json({
      sections: sections.filter((s) => used.has(String(s._id))).map((s) => ({ id: String(s._id), name: s.name, head: s.head ? String(s.head) : null })),
      groups: outGroups,
    });
  } catch (err) {
    console.error("getSaleFilters failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// PUT /api/employee-sales/:id/correction  { amount, note }
// Division managers and finance correct the amount of a pharmacy sale (e.g. an overstated one).
// The original amount (boxes × price) stays as it is; the corrected one is shown next to it and
// used by the finance dashboard. Empty amount -> the correction is removed.
const CORRECTORS = new Set(["admin", "director", "finance manager", "accountant's assistant"]);
export function canCorrectSales(me) {
  const r = (me?.role?.name || "").toLowerCase().trim();
  return CORRECTORS.has(r) || /division manager/.test(r);
}
export async function correctEmployeeSale(req, res) {
  try {
    if (!canCorrectSales(req.employee)) return res.status(403).json({ error: "თანხის კორექტირება მხოლოდ დივიზიონის მენეჯერს და ფინანსებს შეუძლიათ" });
    const sale = await EmployeeSale.findById(req.params.id).select("employee").lean();
    if (!sale) return res.status(404).json({ error: "Not found" });
    if (!(await canSeeEmployee(req.employee, sale.employee))) return res.status(403).json(FORBIDDEN);
    const raw = req.body?.amount;
    const empty = raw === null || raw === undefined || String(raw).trim() === "";
    const amount = empty ? null : Math.round(Number(String(raw).replace(/\s/g, "").replace(",", ".")) * 100) / 100;
    if (!empty && (!Number.isFinite(amount) || amount < 0)) return res.status(400).json({ error: "თანხა უნდა იყოს 0 ან მეტი რიცხვი" });
    const set = empty
      ? { correctedAmount: null, correctionNote: "", correctedBy: null, correctedAt: null }
      : { correctedAmount: amount, correctionNote: String(req.body?.note || "").slice(0, 300), correctedBy: req.employee._id, correctedAt: new Date() };
    await EmployeeSale.updateOne({ _id: req.params.id }, { $set: set });
    res.json({ _id: req.params.id, ...set, correctedByName: empty ? "" : `${req.employee.firstName || ""} ${req.employee.lastName || ""}`.trim() });
  } catch (err) {
    console.error("correctEmployeeSale failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
