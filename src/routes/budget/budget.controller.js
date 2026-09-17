import Budget from "../../models/Budget.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";
import Doctor from "../../models/Doctor.js";
import Prescription from "../../models/Prescription.js";
import DrugPrescription from "../../models/DrugPrescription.js";
import DoctorTarget from "../../models/DoctorTarget.js";
import MedicineTarget from "../../models/MedicineTarget.js";

const POPULATE = "employee doctor region section group";

// auto-fills region/section/group from the employee's Group —
// mirrors Rails' Budget#update_region_group_section_fields
async function resolveOrgFields(employeeId) {
  const employee = await Employee.findById(employeeId).populate("group");
  if (!employee?.group) return { region: null, section: null, group: null };

  const group = await Group.findById(employee.group).populate("region section");
  return {
    region: group?.region?._id || null,
    section: group?.section?._id || null,
    group: group?._id || null,
  };
}

// GET /api/budgets?employee=&doctor=&from=&to=
export async function getAllBudgets(req, res) {
  try {
    const filter = {};
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.doctor) filter.doctor = req.query.doctor;
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) filter.date.$lte = new Date(req.query.to);
    }

    const budgets = await Budget.find(filter).populate(POPULATE).sort({ date: -1 });
    res.json(budgets);
  } catch (err) {
    console.error("getAllBudgets failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/budgets
export async function createBudget(req, res) {
  try {
    const orgFields = await resolveOrgFields(req.body.employee);
    const budget = await Budget.create({ ...req.body, ...orgFields });

    // Rails also flips doctor.isBudgeted = true on save
    await Doctor.findByIdAndUpdate(req.body.doctor, { isBudgeted: true });

    const populated = await budget.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("createBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateBudget(req, res) {
  try {
    // employee shouldn't normally change on update, but re-resolve org
    // fields in case it does
    const orgFields = req.body.employee ? await resolveOrgFields(req.body.employee) : {};
    const budget = await Budget.findByIdAndUpdate(
      req.params.id,
      { ...req.body, ...orgFields },
      { new: true, runValidators: true }
    ).populate(POPULATE);
    if (!budget) return res.status(404).json({ error: "Budget not found" });
    res.json(budget);
  } catch (err) {
    console.error("updateBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteBudget(req, res) {
  try {
    const budget = await Budget.findByIdAndDelete(req.params.id);
    if (!budget) return res.status(404).json({ error: "Budget not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/budgets/allotment?employee_id=&start_date=&end_date=
// Rails' budget_allotment — full page: 4 summary totals, per-doctor paid
// chart, and the employee's raw Budget rows for the table. Defaults to
// last month + the logged-in employee, matching Rails exactly.
export async function getBudgetAllotment(req, res) {
  try {
    const employeeId = req.query.employee_id || String(req.employee._id);

    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const defaultEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const startDate = req.query.start_date ? new Date(req.query.start_date) : defaultStart;
    const endDate = req.query.end_date ? new Date(req.query.end_date) : defaultEnd;
    endDate.setHours(23, 59, 59, 999);

    const filter = { employee: employeeId, date: { $gte: startDate, $lte: endDate } };

    const [docs, employee] = await Promise.all([
      Budget.find(filter).populate("doctor", "firstName lastName uniqueNumber").sort({ date: -1 }),
      Employee.findById(employeeId).select("firstName lastName"),
    ]);

    const totalPaidAmount = Math.round(docs.reduce((s, d) => s + (d.paidAmount || 0), 0) * 100) / 100;

    // prescription + sales amounts — computed fresh across every doctor
    // this employee has prescribed to in the range (not just budgeted ones)
    const prescriptions = await Prescription.find({
      employee: employeeId,
      date: { $gte: startDate, $lte: endDate },
    }).select("_id");
    const items = await DrugPrescription.find({
      prescription: { $in: prescriptions.map((p) => p._id) },
    }).populate("drug", "price");
    let totalPrescriptionAmount = 0;
    let totalSalesAmount = 0;
    items.forEach((it) => {
      const price = it.drug?.price || 0;
      totalPrescriptionAmount += (it.totalNoOfBoxes || 0) * price;
      totalSalesAmount += (it.saleBoxes || 0) * price;
    });

    // target amount — same approach, across every DoctorTarget this
    // employee has in the range
    const doctorTargets = await DoctorTarget.find({
      employee: employeeId,
      date: { $gte: startDate, $lte: endDate },
    }).select("_id");
    const targetRows = await MedicineTarget.find({
      medicineTargatableType: "DoctorTarget",
      medicineTargatableId: { $in: doctorTargets.map((t) => t._id) },
    }).populate("drug", "price");
    let totalTargetAmount = 0;
    targetRows.forEach((t) => {
      totalTargetAmount += (t.totalNoOfBoxes || 0) * (t.drug?.price || 0);
    });

    const chartData = await Budget.aggregate([
      { $match: filter },
      { $group: { _id: "$doctor", paidAmount: { $sum: "$paidAmount" } } },
      { $lookup: { from: "doctors", localField: "_id", foreignField: "_id", as: "doctor" } },
      { $unwind: { path: "$doctor", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          name: {
            $ifNull: [{ $concat: ["$doctor.firstName", " ", "$doctor.lastName"] }, "Unknown Doctor"],
          },
          value: { $round: ["$paidAmount", 2] },
        },
      },
    ]);

    res.json({
      employeeName: employee?.name || "—",
      totalPaidAmount,
      totalTargetAmount: Math.round(totalTargetAmount * 100) / 100,
      totalSalesAmount: Math.round(totalSalesAmount * 100) / 100,
      totalPrescriptionAmount: Math.round(totalPrescriptionAmount * 100) / 100,
      chartData,
      docs: docs.map((d) => ({
        _id: d._id,
        date: d.date,
        doctorName: d.doctor?.name || "—",
        doctorUniqueNumber: d.doctor?.uniqueNumber || "—",
        paidAmount: d.paidAmount,
        advanceAmount: d.advanceAmount,
        salesAmount: d.salesAmount,
        deltaAmount: d.advanceAmount,
        targetAmount: d.targetAmount,
        prescriptionAmt: d.prescriptionAmt,
        isActive: d.isActive,
      })),
    });
  } catch (err) {
    console.error("getBudgetAllotment failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/budgets/compute-amounts?employee=&doctor=&date=
// Auto-fills the Create Budget form once employee+doctor+date are picked —
// mirrors Rails' doctor_prescription_amount, reusing the exact same
// prescription/target formula as the Analytics endpoint.
export async function computeBudgetAmounts(req, res) {
  try {
    const { employee, doctor, date } = req.query;
    if (!employee || !doctor || !date) {
      return res.status(400).json({ error: "employee, doctor and date are required" });
    }

    const d = new Date(date);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

    const { default: Prescription } = await import("../../models/Prescription.js");
    const { default: DrugPrescription } = await import("../../models/DrugPrescription.js");
    const { default: DoctorTarget } = await import("../../models/DoctorTarget.js");
    const { default: MedicineTarget } = await import("../../models/MedicineTarget.js");

    const prescriptions = await Prescription.find({
      doctor,
      employee,
      date: { $gte: monthStart, $lte: monthEnd },
    }).select("_id");
    const prescriptionIds = prescriptions.map((p) => p._id);

    const items = await DrugPrescription.find({
      prescription: { $in: prescriptionIds },
    }).populate("drug", "price bonus");

    let prescriptionAmt = 0;
    let salesAmount = 0;
    let payableAmt = 0;
    items.forEach((it) => {
      const price = it.drug?.price || 0;
      const bonus = it.drug?.bonus || 0;
      prescriptionAmt += (it.totalNoOfBoxes || 0) * price;
      salesAmount += (it.saleBoxes || 0) * price;
      payableAmt += (it.saleBoxes || 0) * bonus;
    });

    const doctorTargets = await DoctorTarget.find({
      doctor,
      employee,
      date: { $gte: monthStart, $lte: monthEnd },
    }).select("_id");
    const targetRows = await MedicineTarget.find({
      medicineTargatableType: "DoctorTarget",
      medicineTargatableId: { $in: doctorTargets.map((t) => t._id) },
    }).populate("drug", "price");
    let targetAmount = 0;
    targetRows.forEach((t) => {
      targetAmount += (t.totalNoOfBoxes || 0) * (t.drug?.price || 0);
    });

    // "delta" — the advanceAmount carried forward from the most recently
    // created Budget for this doctor+employee pair within THIS calendar
    // year (Rails uses the current real year, not the picked date's year)
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const yearEnd = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    const lastBudget = await Budget.findOne({
      doctor,
      employee,
      date: { $gte: yearStart, $lte: yearEnd },
    }).sort({ createdAt: -1 });
    const advanceAmount = lastBudget?.advanceAmount || 0;

    res.json({
      prescriptionAmt: Math.round(prescriptionAmt * 100) / 100,
      salesAmount: Math.round(salesAmount * 100) / 100,
      payableAmt: Math.round(payableAmt * 100) / 100,
      targetAmount: Math.round(targetAmount * 100) / 100,
      advanceAmount: Math.round(advanceAmount * 100) / 100,
    });
  } catch (err) {
    console.error("computeBudgetAmounts failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
