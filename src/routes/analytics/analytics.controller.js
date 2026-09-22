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
  }).select("_id");
  const prescriptionIds = prescriptions.map((p) => p._id);

  const items = await DrugPrescription.find({
    prescription: { $in: prescriptionIds },
  }).populate("drug", "name price bonus");

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
        .limit(limitNum),
      DoctorTarget.countDocuments(filter),
    ]);

    const targetIds = docs.map((d) => d._id);
    const targets = await MedicineTarget.find({
      medicineTargatableType: "DoctorTarget",
      medicineTargatableId: { $in: targetIds },
    }).populate("drug", "price");

    const targetByRow = new Map();
    targets.forEach((t) => {
      const key = String(t.medicineTargatableId);
      const entry = targetByRow.get(key) || { amount: 0, boxes: 0 };
      entry.amount += (t.totalNoOfBoxes || 0) * (t.drug?.price || 0);
      entry.boxes += t.totalNoOfBoxes || 0;
      targetByRow.set(key, entry);
    });

    // cache prescription/sales/payable stats + budget paid/delta per
    // doctor+employee pair, since Rails recomputes these using the global
    // from/to filter (not each row's own month) — same pair repeats often
    const pairCache = new Map();

    const rows = await Promise.all(
      docs.map(async (d) => {
        const pairKey = `${d.doctor?._id}_${d.employee?._id}`;
        let pairStats = pairCache.get(pairKey);
        if (!pairStats) {
          const [prescStats, budgetAgg] = await Promise.all([
            getPrescriptionStats(d.doctor?._id, d.employee?._id, fromDate, toDate),
            Budget.aggregate([
              {
                $match: {
                  doctor: d.doctor?._id,
                  employee: d.employee?._id,
                  date: { $gte: fromDate, $lte: toDate },
                },
              },
              {
                $group: {
                  _id: null,
                  paid: { $sum: "$paidAmount" },
                  delta: { $sum: "$advanceAmount" },
                },
              },
            ]),
          ]);
          pairStats = {
            ...prescStats,
            paidAmount: Math.round((budgetAgg[0]?.paid || 0) * 100) / 100,
            deltaAmount: Math.round((budgetAgg[0]?.delta || 0) * 100) / 100,
          };
          pairCache.set(pairKey, pairStats);
        }

        // visits — scoped to THIS row's own month, unlike the pair stats above
        const monthStart = new Date(d.date.getFullYear(), d.date.getMonth(), 1);
        const monthEnd = new Date(d.date.getFullYear(), d.date.getMonth() + 1, 0, 23, 59, 59, 999);
        const planIds = await PlanConfiguration.find({
          performer: d.employee?._id,
          period: { $gte: monthStart, $lte: monthEnd },
          status: "completed",
        }).distinct("_id");
        const visits = await PlanConfigurationDoctor.countDocuments({
          planConfiguration: { $in: planIds },
          doctor: d.doctor?._id,
        });

        const targetEntry = targetByRow.get(String(d._id)) || { amount: 0, boxes: 0 };

        return {
          _id: d._id,
          date: d.date,
          employeeName: d.employee?.name || "—",
          doctorName: d.doctor?.name || "—",
          doctorIsBudgeted: !!d.doctor?.isBudgeted,
          visits,
          targetAmount: Math.round(targetEntry.amount * 100) / 100,
          targetBoxes: targetEntry.boxes,
          ...pairStats,
        };
      })
    );

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
