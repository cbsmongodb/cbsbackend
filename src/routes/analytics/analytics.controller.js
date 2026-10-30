import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import Drug from "../../models/Drug.js";
import { monthOfDate } from "../../utils/budgetSync.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";
import DoctorTarget from "../../models/DoctorTarget.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import Employee from "../../models/Employee.js";
import Doctor from "../../models/Doctor.js";
import Group from "../../models/Group.js";
import PlanConfiguration from "../../models/PlanConfiguration.js";
import PlanConfigurationDoctor from "../../models/PlanConfigurationDoctor.js";
import Prescription from "../../models/Prescription.js";
import DrugPrescription from "../../models/DrugPrescription.js";
import Budget from "../../models/Budget.js";

async function resolveEmployeeIdsForScope(sectionId, groupId) {
  // Group.members[] is basically never populated in real data — the
  // real membership signal lives on Employee.group. Query it directly.
  if (groupId) {
    return await Employee.find({ group: groupId }).distinct("_id");
  }
  if (sectionId) {
    const groupIds = await Group.find({ section: sectionId }).distinct("_id");
    return await Employee.find({ group: { $in: groupIds } }).distinct("_id");
  }
  return null;
}

// aggregates Prescription+DrugPrescription for one doctor+employee pair
// within [fromDate, toDate] — matches Doctor.get_prescription_amount/
// get_sales_amount/doctor_payable_amount etc from Rails
async function getPrescriptionStats(doctorId, employeeId, fromDate, toDate) {
  const prescriptions = await Prescription.find({
    doctor: doctorId,
    employee: employeeId,
    date: { $gte: fromDate, $lte: toDate },
  }).select("_id").lean();
  const prescriptionIds = prescriptions.map((p) => p._id);

  const items = await DrugPrescription.find({
    prescription: { $in: prescriptionIds },
  })
    .select("drug totalNoOfBoxes saleBoxes")
    .populate("drug", "name price bonus")
    .lean();

  return statsFromItems(items);
}

// the same numbers getPrescriptionStats returns, from already-loaded drug lines
function statsFromItems(items) {
  let prescriptionAmount = 0;
  let prescriptionBoxes = 0;
  let salesAmount = 0;
  let saleBoxes = 0;
  let payableAmount = 0;

  // per-drug breakdown, merged across all of this doctor+employee's
  // prescriptions in the period — matches Rails analytics.xlsx's dynamic
  // per-product column block (prescription/sales/coefficient/bonus/payable)
  const byDrug = new Map();

  items.forEach((it) => {
    const price = it.drug?.price || 0;
    const bonus = it.drug?.bonus || 0;
    const boxes = it.totalNoOfBoxes || 0;
    const sold = it.saleBoxes || 0;
    prescriptionAmount += boxes * price;
    prescriptionBoxes += boxes;
    salesAmount += sold * price;
    saleBoxes += sold;
    payableAmount += sold * bonus;

    const drugName = it.drug?.name || "—";
    const entry = byDrug.get(drugName) || {
      drugName,
      prescriptionAmount: 0,
      totalBoxes: 0,
      salesAmount: 0,
      saleBoxes: 0,
      bonus,
      payableAmount: 0,
    };
    entry.prescriptionAmount += boxes * price;
    entry.totalBoxes += boxes;
    entry.salesAmount += sold * price;
    entry.saleBoxes += sold;
    entry.payableAmount += sold * bonus;
    byDrug.set(drugName, entry);
  });

  const drugBreakdown = Array.from(byDrug.values()).map((d) => ({
    drugName: d.drugName,
    prescriptionAmount: Math.round(d.prescriptionAmount * 100) / 100,
    salesAmount: Math.round(d.salesAmount * 100) / 100,
    coefficient: d.totalBoxes > 0 ? Math.round((d.saleBoxes / d.totalBoxes) * 10000) / 100 : 0,
    bonus: d.bonus,
    payableAmount: Math.round(d.payableAmount * 100) / 100,
  }));

  return {
    prescriptionAmount: Math.round(prescriptionAmount * 100) / 100,
    prescriptionBoxes,
    salesAmount: Math.round(salesAmount * 100) / 100,
    saleBoxes,
    payableAmount: Math.round(payableAmount * 100) / 100,
    drugBreakdown,
  };
}

// prescription / sales / payable stats + budget paid / delta for MANY
// doctor+employee pairs at once (4 queries instead of ~3 per pair)
async function batchPairStats(pairs, fromDate, toDate) {
  const doctorIds = [...new Set(pairs.map((p) => p.doctor).filter(Boolean).map(String))];
  const employeeIds = [...new Set(pairs.map((p) => p.employee).filter(Boolean).map(String))];
  const result = new Map();
  if (!doctorIds.length || !employeeIds.length) return result;

  const prescriptions = await Prescription.find({
    doctor: { $in: doctorIds },
    employee: { $in: employeeIds },
    date: { $gte: fromDate, $lte: toDate },
  })
    .select("_id doctor employee")
    .lean();
  const pairOfRx = new Map(prescriptions.map((p) => [String(p._id), `${p.doctor}_${p.employee}`]));

  const [items, budgets] = await Promise.all([
    prescriptions.length
      ? DrugPrescription.find({ prescription: { $in: prescriptions.map((p) => p._id) } })
          .select("prescription drug totalNoOfBoxes saleBoxes")
          .populate("drug", "name price bonus")
          .lean()
      : [],
    Budget.aggregate([
      {
        $match: {
          doctor: { $in: doctorIds.map((id) => new Budget.base.Types.ObjectId(id)) },
          employee: { $in: employeeIds.map((id) => new Budget.base.Types.ObjectId(id)) },
          date: { $gte: fromDate, $lte: toDate },
        },
      },
      {
        $group: {
          _id: { doctor: "$doctor", employee: "$employee" },
          paid: { $sum: "$paidAmount" },
          delta: { $sum: "$advanceAmount" },
        },
      },
    ]),
  ]);

  const itemsByPair = new Map();
  items.forEach((it) => {
    const key = pairOfRx.get(String(it.prescription));
    if (!key) return;
    if (!itemsByPair.has(key)) itemsByPair.set(key, []);
    itemsByPair.get(key).push(it);
  });
  const budgetByPair = new Map(budgets.map((b) => [`${b._id.doctor}_${b._id.employee}`, b]));

  pairs.forEach((p) => {
    const key = `${p.doctor}_${p.employee}`;
    if (result.has(key)) return;
    const b = budgetByPair.get(key);
    result.set(key, {
      ...statsFromItems(itemsByPair.get(key) || []),
      paidAmount: Math.round((b?.paid || 0) * 100) / 100,
      deltaAmount: Math.round((b?.delta || 0) * 100) / 100,
    });
  });
  return result;
}

// completed-visit counts per row (row's own month, its employee + doctor) for
// all rows at once — instead of 2 queries per row
async function batchVisits(docs) {
  const visits = new Map();
  const withRefs = docs.filter((d) => d.doctor?._id && d.employee?._id && d.date);
  if (!withRefs.length) return visits;
  const monthRange = (date) => [
    new Date(date.getFullYear(), date.getMonth(), 1),
    new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999),
  ];
  const ranges = withRefs.map((d) => monthRange(new Date(d.date)));
  const minStart = new Date(Math.min(...ranges.map((r) => r[0].getTime())));
  const maxEnd = new Date(Math.max(...ranges.map((r) => r[1].getTime())));

  const plans = await PlanConfiguration.find({
    performer: { $in: [...new Set(withRefs.map((d) => String(d.employee._id)))] },
    period: { $gte: minStart, $lte: maxEnd },
    status: "completed",
  })
    .select("_id performer period")
    .lean();
  if (!plans.length) return visits;

  const counts = await PlanConfigurationDoctor.aggregate([
    {
      $match: {
        planConfiguration: { $in: plans.map((p) => p._id) },
        doctor: { $in: [...new Set(withRefs.map((d) => String(d.doctor._id)))].map((id) => new PlanConfigurationDoctor.base.Types.ObjectId(id)) },
      },
    },
    { $group: { _id: { plan: "$planConfiguration", doctor: "$doctor" }, n: { $sum: 1 } } },
  ]);
  const countByPlanDoctor = new Map(counts.map((c) => [`${c._id.plan}_${c._id.doctor}`, c.n]));
  const plansByEmployee = new Map();
  plans.forEach((p) => {
    const k = String(p.performer);
    if (!plansByEmployee.has(k)) plansByEmployee.set(k, []);
    plansByEmployee.get(k).push(p);
  });

  withRefs.forEach((d, i) => {
    const [start, end] = ranges[i];
    let n = 0;
    (plansByEmployee.get(String(d.employee._id)) || []).forEach((p) => {
      if (p.period >= start && p.period <= end) n += countByPlanDoctor.get(`${p._id}_${d.doctor._id}`) || 0;
    });
    visits.set(String(d._id), n);
  });
  return visits;
}

// ---------------------------------------------------------------------------
// analytics-v2: rows come from what reps enter now ("Prescription entry" =
// DoctorEntryItem: one line per employee + doctor + drug + month) plus the
// pharmacy sales coefficient, budgets (paid / delta) and completed visits.
// Old DoctorTarget rows (Rails era) are still shown for months that have no
// new entries for that employee + doctor.
// ---------------------------------------------------------------------------
const H12 = 12 * 3600 * 1000;
const VISITED = ["i_went", "i_left", "completed"];
const ymOf = (d) => {
  const m = monthOfDate(d);
  return `${m.y}-${m.m}`;
};
const tbilisiMonth = ({ y, m }) => [
  new Date(Date.UTC(y, m, 1) - 4 * 3600 * 1000),
  new Date(Date.UTC(y, m + 1, 1) - 4 * 3600 * 1000 - 1),
];
const r2 = (n) => Math.round((n || 0) * 100) / 100;

// stats of one employee+doctor+month from its DoctorEntryItem lines
function statsFromEntryItems(items, drugById) {
  let prescriptionAmount = 0, prescriptionBoxes = 0, salesAmount = 0, saleBoxes = 0;
  let payableAmount = 0, targetAmount = 0, targetBoxes = 0;
  const byDrug = new Map();
  for (const it of items) {
    const drug = drugById.get(String(it.drug)) || {};
    const price = drug.price || 0;
    const rx = it.prescription || 0;
    const coef = it.coefficient || 0;
    // sales per doctor = prescriptions x the employee's real sales coefficient
    // (pharmacy sales are per employee + drug, not per doctor)
    const sold = coef > 0 ? rx * coef : it.sale || 0;
    const pay = it.totalBudget || sold * (it.budget || 0);
    prescriptionAmount += rx * price;
    prescriptionBoxes += rx;
    salesAmount += sold * price;
    saleBoxes += sold;
    payableAmount += pay;
    targetAmount += (it.quota || 0) * price;
    targetBoxes += it.quota || 0;

    const name = drug.name || "—";
    const e = byDrug.get(name) || { drugName: name, prescriptionAmount: 0, totalBoxes: 0,
      salesAmount: 0, saleBoxes: 0, bonus: it.budget || drug.bonus || 0, payableAmount: 0 };
    e.prescriptionAmount += rx * price;
    e.totalBoxes += rx;
    e.salesAmount += sold * price;
    e.saleBoxes += sold;
    e.payableAmount += pay;
    byDrug.set(name, e);
  }
  return {
    targetAmount: r2(targetAmount),
    targetBoxes: Math.round(targetBoxes * 100) / 100,
    prescriptionAmount: r2(prescriptionAmount),
    prescriptionBoxes: Math.round(prescriptionBoxes * 100) / 100,
    salesAmount: r2(salesAmount),
    saleBoxes: Math.round(saleBoxes * 100) / 100,
    payableAmount: r2(payableAmount),
    drugBreakdown: [...byDrug.values()].map((d) => ({
      drugName: d.drugName,
      prescriptionAmount: r2(d.prescriptionAmount),
      salesAmount: r2(d.salesAmount),
      coefficient: d.totalBoxes > 0 ? Math.round((d.saleBoxes / d.totalBoxes) * 10000) / 100 : 0,
      bonus: d.bonus,
      payableAmount: r2(d.payableAmount),
    })),
  };
}

// visits (visited plans with this doctor) per employee+doctor+Georgian month
async function visitsByPairMonth(rows) {
  const out = new Map();
  if (!rows.length) return out;
  const months = rows.map((r) => tbilisiMonth(monthOfDate(r.date)));
  const minStart = new Date(Math.min(...months.map((m) => +m[0])));
  const maxEnd = new Date(Math.max(...months.map((m) => +m[1])));
  const plans = await PlanConfiguration.find({
    performer: { $in: [...new Set(rows.map((r) => r.employee))] },
    period: { $gte: minStart, $lte: maxEnd },
    status: { $in: VISITED },
  }).select("_id performer period").lean();
  if (!plans.length) return out;
  const OID = PlanConfigurationDoctor.base.Types.ObjectId;
  const links = await PlanConfigurationDoctor.find({
    planConfiguration: { $in: plans.map((p) => p._id) },
    doctor: { $in: [...new Set(rows.map((r) => r.doctor))].map((id) => new OID(id)) },
  }).select("planConfiguration doctor").lean();
  const planById = new Map(plans.map((p) => [String(p._id), p]));
  for (const l of links) {
    const p = planById.get(String(l.planConfiguration));
    if (!p) continue;
    const k = `${p.performer}|${l.doctor}|${ymOf(p.period)}`;
    out.set(k, (out.get(k) || 0) + 1);
  }
  return out;
}

// paid / delta from Budgets per employee+doctor+Georgian month
async function budgetsByPairMonth(rows) {
  const out = new Map();
  if (!rows.length) return out;
  const months = rows.map((r) => tbilisiMonth(monthOfDate(r.date)));
  const budgets = await Budget.find({
    employee: { $in: [...new Set(rows.map((r) => r.employee))] },
    doctor: { $in: [...new Set(rows.map((r) => r.doctor))] },
    date: { $gte: new Date(Math.min(...months.map((m) => +m[0]))), $lte: new Date(Math.max(...months.map((m) => +m[1]))) },
  }).select("employee doctor date paidAmount advanceAmount").lean();
  for (const b of budgets) {
    if (!b.date) continue;
    const k = `${b.employee}|${b.doctor}|${ymOf(b.date)}`;
    const e = out.get(k) || { paid: 0, delta: 0 };
    e.paid += b.paidAmount || 0;
    e.delta += b.advanceAmount || 0;
    out.set(k, e);
  }
  return out;
}

// GET /api/analytics?fromDate=&toDate=&doctor=&employee=&section=&group=&search=&page=&limit=
export async function getAnalytics(req, res) {
  try {
    const { search, doctor, employee, section, group, page, limit } = req.query;

    const now = new Date();
    const fromDate = req.query.fromDate ? new Date(req.query.fromDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = req.query.toDate ? new Date(req.query.toDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    toDate.setHours(23, 59, 59, 999);

    // shared employee / doctor filter for both sources
    const who = {};
    if (doctor) who.doctor = doctor;
    if (employee) who.employee = employee;
    const scopedEmployeeIds = await resolveEmployeeIdsForScope(section, group);
    if (scopedEmployeeIds) who.employee = who.employee || { $in: scopedEmployeeIds };
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const [matchingDoctors, matchingEmployees] = await Promise.all([
        Doctor.find({ $or: [{ firstName: regex }, { lastName: regex }] }).distinct("_id"),
        Employee.find({ $or: [{ firstName: regex }, { lastName: regex }] }).distinct("_id"),
      ]);
      who.$or = [{ doctor: { $in: matchingDoctors } }, { employee: { $in: matchingEmployees } }];
    }
    // reps see themselves, managers their group / division, admins everyone
    const scope = await getScopeEmployeeIds(req.employee);
    if (scope) {
      const allowed = new Set(scope.map(String));
      if (who.employee && typeof who.employee !== "object") {
        if (!allowed.has(String(who.employee))) who.employee = { $in: [] };
      } else if (who.employee?.$in) {
        who.employee = { $in: who.employee.$in.filter((id) => allowed.has(String(id))) };
      } else {
        who.employee = { $in: scope };
      }
    }

    // ---- new entries (period = 1st of the month; ±12h for time zones) ----
    const items = await DoctorEntryItem.find({
      ...who,
      period: { $gte: new Date(+fromDate - H12), $lte: new Date(+toDate - H12) },
    })
      .select("employee doctor drug period quota prescription sale coefficient budget totalBudget")
      .lean();
    const drugIds = [...new Set(items.map((i) => String(i.drug)))];
    const drugs = drugIds.length ? await Drug.find({ _id: { $in: drugIds } }).select("name price bonus").lean() : [];
    const drugById = new Map(drugs.map((d) => [String(d._id), d]));

    const entryRows = new Map();
    for (const it of items) {
      const k = `${it.employee}|${it.doctor}|${ymOf(it.period)}`;
      if (!entryRows.has(k)) {
        entryRows.set(k, { key: k, source: "entry", employee: String(it.employee), doctor: String(it.doctor), date: it.period, items: [] });
      }
      entryRows.get(k).items.push(it);
    }

    // ---- old DoctorTarget rows, only where there is nothing new ----
    const legacy = await DoctorTarget.find({ ...who, date: { $gte: fromDate, $lte: toDate } })
      .select("_id employee doctor date")
      .lean();
    const legacyRows = [];
    for (const d of legacy) {
      if (!d.employee || !d.doctor || !d.date) continue;
      const k = `${d.employee}|${d.doctor}|${ymOf(d.date)}`;
      if (entryRows.has(k)) continue;
      legacyRows.push({ key: `legacy-${d._id}`, source: "legacy", _id: d._id, employee: String(d.employee), doctor: String(d.doctor), date: d.date });
    }

    // ---- names, sort, page ----
    const all = [...entryRows.values(), ...legacyRows];
    const [emps, docs] = await Promise.all([
      Employee.find({ _id: { $in: [...new Set(all.map((r) => r.employee))] } }).select("firstName lastName").lean(),
      Doctor.find({ _id: { $in: [...new Set(all.map((r) => r.doctor))] } }).select("firstName lastName isBudgeted").lean(),
    ]);
    const empById = new Map(emps.map((e) => [String(e._id), e]));
    const docById = new Map(docs.map((d) => [String(d._id), d]));
    const nameOf = (x) => (x ? x.name || [x.firstName, x.lastName].filter(Boolean).join(" ") : "—");
    all.forEach((r) => {
      r.employeeName = nameOf(empById.get(r.employee));
      r.doctorName = nameOf(docById.get(r.doctor));
      r.doctorIsBudgeted = !!docById.get(r.doctor)?.isBudgeted;
    });
    all.sort(
      (a, b) =>
        +new Date(b.date) - +new Date(a.date) ||
        a.employeeName.localeCompare(b.employeeName) ||
        a.doctorName.localeCompare(b.doctorName)
    );

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const pageRows = all.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    // ---- numbers for this page only ----
    const pageLegacy = pageRows.filter((r) => r.source === "legacy");
    const [visits, paid, legacyTargets, legacyStats] = await Promise.all([
      visitsByPairMonth(pageRows),
      budgetsByPairMonth(pageRows),
      pageLegacy.length
        ? MedicineTarget.find({ medicineTargatableType: "DoctorTarget", medicineTargatableId: { $in: pageLegacy.map((r) => r._id) } })
            .select("medicineTargatableId totalNoOfBoxes drug").populate("drug", "price").lean()
        : [],
      pageLegacy.length
        ? batchPairStats(pageLegacy.map((r) => ({ doctor: r.doctor, employee: r.employee })), fromDate, toDate)
        : new Map(),
    ]);
    const legacyTargetByRow = new Map();
    legacyTargets.forEach((t) => {
      const k = String(t.medicineTargatableId);
      const e = legacyTargetByRow.get(k) || { amount: 0, boxes: 0 };
      e.amount += (t.totalNoOfBoxes || 0) * (t.drug?.price || 0);
      e.boxes += t.totalNoOfBoxes || 0;
      legacyTargetByRow.set(k, e);
    });

    const rows = pageRows.map((r) => {
      const pm = `${r.employee}|${r.doctor}|${ymOf(r.date)}`;
      const b = paid.get(pm);
      const base = {
        _id: r.key,
        date: r.date,
        employeeName: r.employeeName,
        doctorName: r.doctorName,
        doctorIsBudgeted: r.doctorIsBudgeted,
        visits: visits.get(pm) || 0,
      };
      if (r.source === "entry") {
        return { ...base, ...statsFromEntryItems(r.items, drugById), paidAmount: r2(b?.paid), deltaAmount: r2(b?.delta) };
      }
      const t = legacyTargetByRow.get(String(r._id)) || { amount: 0, boxes: 0 };
      const s = legacyStats.get(`${r.doctor}_${r.employee}`) || { ...statsFromItems([]), paidAmount: 0, deltaAmount: 0 };
      return {
        ...base,
        targetAmount: r2(t.amount),
        targetBoxes: t.boxes,
        ...s,
        paidAmount: b ? r2(b.paid) : s.paidAmount,
        deltaAmount: b ? r2(b.delta) : s.deltaAmount,
      };
    });

    res.json({
      docs: rows,
      total: all.length,
      page: pageNum,
      pages: Math.max(Math.ceil(all.length / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAnalytics failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
