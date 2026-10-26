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

// GET /api/analytics?fromDate=&toDate=&doctor=&employee=&section=&group=&search=&page=&limit=
export async function getAnalytics(req, res) {
  try {
    const { search, doctor, employee, section, group, page, limit } = req.query;

    const now = new Date();
    const fromDate = req.query.fromDate ? new Date(req.query.fromDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = req.query.toDate ? new Date(req.query.toDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    toDate.setHours(23, 59, 59, 999);

    const filter = { date: { $gte: fromDate, $lte: toDate } };
    if (doctor) filter.doctor = doctor;
    if (employee) filter.employee = employee;

    const scopedEmployeeIds = await resolveEmployeeIdsForScope(section, group);
    if (scopedEmployeeIds) {
      filter.employee = filter.employee || { $in: scopedEmployeeIds };
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const [matchingDoctors, matchingEmployees] = await Promise.all([
        Doctor.find({ $or: [{ firstName: regex }, { lastName: regex }] }).distinct("_id"),
        Employee.find({ $or: [{ firstName: regex }, { lastName: regex }] }).distinct("_id"),
      ]);
      filter.$or = [
        { doctor: { $in: matchingDoctors } },
        { employee: { $in: matchingEmployees } },
      ];
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      DoctorTarget.find(filter)
        .populate("doctor", "firstName lastName isBudgeted")
        .populate("employee", "firstName lastName")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      DoctorTarget.countDocuments(filter),
    ]);

    const targetIds = docs.map((d) => d._id);
    const targets = await MedicineTarget.find({
      medicineTargatableType: "DoctorTarget",
      medicineTargatableId: { $in: targetIds },
    })
      .select("medicineTargatableId totalNoOfBoxes drug")
      .populate("drug", "price")
      .lean();

    const targetByRow = new Map();
    targets.forEach((t) => {
      const key = String(t.medicineTargatableId);
      const entry = targetByRow.get(key) || { amount: 0, boxes: 0 };
      entry.amount += (t.totalNoOfBoxes || 0) * (t.drug?.price || 0);
      entry.boxes += t.totalNoOfBoxes || 0;
      targetByRow.set(key, entry);
    });

    // stats per doctor+employee pair use the global from/to filter (like Rails);
    // visits use each row's own month — both computed for all rows at once
    const [pairStats, visitsByRow] = await Promise.all([
      batchPairStats(
        docs.map((d) => ({ doctor: d.doctor?._id, employee: d.employee?._id })),
        fromDate,
        toDate
      ),
      batchVisits(docs),
    ]);
    const emptyStats = statsFromItems([]);

    const rows = docs.map((d) => {
      const targetEntry = targetByRow.get(String(d._id)) || { amount: 0, boxes: 0 };
      const stats = pairStats.get(`${d.doctor?._id}_${d.employee?._id}`) || { ...emptyStats, paidAmount: 0, deltaAmount: 0 };
      return {
        _id: d._id,
        date: d.date,
        employeeName: d.employee?.name || "—",
        doctorName: d.doctor?.name || "—",
        doctorIsBudgeted: !!d.doctor?.isBudgeted,
        visits: visitsByRow.get(String(d._id)) || 0,
        targetAmount: Math.round(targetEntry.amount * 100) / 100,
        targetBoxes: targetEntry.boxes,
        ...stats,
      };
    });

    res.json({
      docs: rows,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAnalytics failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
