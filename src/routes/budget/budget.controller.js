import Budget from "../../models/Budget.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";
import Doctor from "../../models/Doctor.js";
import Prescription from "../../models/Prescription.js";
import DrugPrescription from "../../models/DrugPrescription.js";
import DoctorTarget from "../../models/DoctorTarget.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import "../../models/Drug.js";
import { syncIssuedBudgetSafe } from "../../utils/budgetSync.js";
import { getScopeEmployeeIds, applyEmployeeScope, canSeeEmployee } from "../../utils/groupVisibility.js";

const OTHER_DIVISION = { error: "ეს ბიუჯეტი სხვა დივიზიონს ეკუთვნის" };

// doctorBalance: the doctor's balance carried in from earlier months
// (this doctor + this employee, budgets from October 2026 on):
//   + what we paid the doctor  − what the prescriptions accrued
// negative = we still owe the doctor, positive = paid ahead.
// Nothing is stored — it's recalculated from the saved budgets, so old data stays as it is.
const BALANCE_FROM = new Date(2026, 9, 1);
async function openingBalance(employee, doctor, monthStart) {
  if (monthStart <= BALANCE_FROM) return 0;
  const rows = await Budget.find({
    employee,
    doctor,
    isActive: { $ne: false },
    date: { $gte: BALANCE_FROM, $lt: monthStart },
  }).select("paidAmount payableAmt").lean();
  return rows.reduce((s, b) => s + (b.paidAmount || 0) - (b.payableAmt || 0), 0);
}

const POPULATE = "employee doctor region section group";

// auto-fills region/section/group from the employee's Group —
// mirrors Rails' Budget#update_region_group_section_fields
async function resolveOrgFields(employeeId) {
  const employee = await Employee.findById(employeeId).populate("group").lean();
  if (!employee?.group) return { region: null, section: null, group: null };

  const group = await Group.findById(employee.group._id || employee.group).populate("region section").lean();
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
    await applyEmployeeScope(req.employee, filter);

    const budgets = await Budget.find(filter).populate(POPULATE).sort({ date: -1 }).lean();
    res.json(budgets);
  } catch (err) {
    console.error("getAllBudgets failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/budgets/:id - one budget (for the edit form)
export async function getBudgetById(req, res) {
  try {
    const budget = await Budget.findById(req.params.id).lean();
    if (!budget) return res.status(404).json({ error: "Budget not found" });
    if (!(await canSeeEmployee(req.employee, budget.employee))) {
      return res.status(403).json(OTHER_DIVISION);
    }
    res.json(budget);
  } catch (err) {
    console.error("getBudgetById failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/budgets
export async function createBudget(req, res) {
  try {
    if (!(await canSeeEmployee(req.employee, req.body.employee))) {
      return res.status(403).json(OTHER_DIVISION);
    }
    const orgFields = await resolveOrgFields(req.body.employee);
    const budget = await Budget.create({ ...req.body, ...orgFields });

    // Rails also flips doctor.isBudgeted = true on save
    await Doctor.findByIdAndUpdate(req.body.doctor, { isBudgeted: true });
    await syncIssuedBudgetSafe(budget);

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
    const current = await Budget.findById(req.params.id).select("employee doctor date").lean();
    if (!current) return res.status(404).json({ error: "Budget not found" });
    if (!(await canSeeEmployee(req.employee, current.employee))) return res.status(403).json(OTHER_DIVISION);
    if (req.body.employee && !(await canSeeEmployee(req.employee, req.body.employee))) {
      return res.status(403).json(OTHER_DIVISION);
    }

    // employee shouldn't normally change on update, but re-resolve org
    // fields in case it does
    const orgFields = req.body.employee ? await resolveOrgFields(req.body.employee) : {};
    const budget = await Budget.findByIdAndUpdate(
      req.params.id,
      { ...req.body, ...orgFields },
      { new: true, runValidators: true }
    ).populate(POPULATE);
    if (!budget) return res.status(404).json({ error: "Budget not found" });
    await syncIssuedBudgetSafe(current, { employee: budget.employee?._id || budget.employee, doctor: budget.doctor?._id || budget.doctor, date: budget.date });
    res.json(budget);
  } catch (err) {
    console.error("updateBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteBudget(req, res) {
  try {
    const budget = await Budget.findById(req.params.id).select("employee doctor date").lean();
    if (!budget) return res.status(404).json({ error: "Budget not found" });
    if (!(await canSeeEmployee(req.employee, budget.employee))) return res.status(403).json(OTHER_DIVISION);
    await Budget.findByIdAndDelete(req.params.id);
    await syncIssuedBudgetSafe(budget);
    res.json({ success: true });
  } catch (err) {
    console.error("deleteBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/budgets/allotment/filters -> divisions / groups this user may see
export async function getBudgetAllotmentFilters(req, res) {
  try {
    const { filtersFor } = await import("../../utils/divisionFilters.js");
    res.json(await filtersFor(await getScopeEmployeeIds(req.employee)));
  } catch (err) {
    console.error("getBudgetAllotmentFilters failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/budgets/allotment?month=YYYY-MM&section=&group=&employee_id=
// allotmentMonth: one month, one employee / a group / a division / everyone.
// Every line: paid to the doctor, the doctor's sales, the doctor's quota, the doctor's balance.
// balance = everything paid − everything accrued (payable) for this doctor + employee,
// from October 2026 up to this budget. Negative = we owe the doctor.
export async function getBudgetAllotment(req, res) {
  try {
    const { peopleOf } = await import("../../utils/divisionFilters.js");
    const scope = await getScopeEmployeeIds(req.employee); // null = sees everyone
    const inScope = (id) => !scope || scope.some((s) => String(s) === String(id));

    // which month (Georgian calendar); default = last month
    let month = String(req.query.month || "");
    if (!/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date(Date.now() + 4 * 3600e3);
      const lm = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      month = lm.toISOString().slice(0, 7);
    }
    const [y, m] = month.split("-").map(Number);
    const startDate = new Date(Date.UTC(y, m - 1, 1) - 4 * 3600e3);
    const endDate = new Date(Date.UTC(y, m, 1) - 4 * 3600e3 - 1);

    // whose budgets
    let people = null; // null = everyone this user may see
    if (req.query.employee_id) {
      if (!inScope(req.query.employee_id)) return res.status(403).json({ error: "Not allowed" });
      people = [String(req.query.employee_id)];
    } else {
      const only = await peopleOf(req.query.section, req.query.group);
      if (only) people = only.filter(inScope);
      else if (scope) people = scope.map(String);
    }

    const filter = { date: { $gte: startDate, $lte: endDate } };
    if (people) filter.employee = { $in: people };

    const docs = await Budget.find(filter)
      .select("date employee doctor paidAmount payableAmt salesAmount targetAmount isActive")
      .populate("doctor", "firstName lastName uniqueNumber")
      .populate("employee", "firstName lastName")
      .sort({ date: -1 })
      .lean();

    const idOf = (v) => String(v?._id || v || "");
    const BAL_FROM = new Date(Date.UTC(2026, 9, 1) - 4 * 3600e3); // 1 Oct 2026, Tbilisi
    const pairKey = (e, d) => `${idOf(e)}|${idOf(d)}`;

    // history of the same doctor + employee pairs, from October up to this month's end
    const pairs = new Map();
    if (endDate >= BAL_FROM && docs.length) {
      const empIds = [...new Set(docs.map((d) => idOf(d.employee)).filter(Boolean))];
      const docIds = [...new Set(docs.map((d) => idOf(d.doctor)).filter(Boolean))];
      const history = await Budget.find({
        employee: { $in: empIds }, doctor: { $in: docIds },
        isActive: { $ne: false }, date: { $gte: BAL_FROM, $lte: endDate },
      }).select("employee doctor date paidAmount payableAmt").lean();
      history.forEach((h) => {
        const k = pairKey(h.employee, h.doctor);
        if (!pairs.has(k)) pairs.set(k, []);
        pairs.get(k).push({ t: new Date(h.date).getTime(), v: (h.paidAmount || 0) - (h.payableAmt || 0) });
      });
    }
    const r2 = (n) => Math.round((n || 0) * 100) / 100;
    const balanceOf = (d) => {
      const own = (d.paidAmount || 0) - (d.payableAmt || 0);
      if (!d.date || new Date(d.date) < BAL_FROM) return r2(own);
      const upTo = new Date(d.date).getTime();
      const sum = (pairs.get(pairKey(d.employee, d.doctor)) || []).filter((h) => h.t <= upTo).reduce((s, h) => s + h.v, 0);
      return r2(d.isActive === false ? sum + own : sum); // a deleted budget isn't in the history
    };

    const rows = docs.map((d) => ({
      _id: d._id,
      date: d.date,
      employeeName: d.employee ? `${d.employee.firstName || ""} ${d.employee.lastName || ""}`.trim() : "—",
      doctorName: d.doctor?.name || (d.doctor ? `${d.doctor.firstName || ""} ${d.doctor.lastName || ""}`.trim() : "—"),
      doctorUniqueNumber: d.doctor?.uniqueNumber || "—",
      paidAmount: r2(d.paidAmount),
      salesAmount: r2(d.salesAmount),
      targetAmount: r2(d.targetAmount),
      balance: balanceOf(d),
      isActive: d.isActive !== false,
      pair: pairKey(d.employee, d.doctor),
    }));

    // totals: active budgets only; balance = each doctor's balance at the month's end
    const active = rows.filter((r) => r.isActive);
    const lastBal = new Map();
    [...active].sort((a, b) => new Date(a.date) - new Date(b.date)).forEach((r) => lastBal.set(r.pair, r.balance));
    const sum = (k) => r2(active.reduce((s, r) => s + (r[k] || 0), 0));

    res.json({
      month,
      totalPaidAmount: sum("paidAmount"),
      totalSalesAmount: sum("salesAmount"),
      totalTargetAmount: sum("targetAmount"),
      totalBalance: r2([...lastBal.values()].reduce((s, v) => s + v, 0)),
      docs: rows.map(({ pair, ...r }) => r),
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
    if (!(await canSeeEmployee(req.employee, employee))) return res.status(403).json(OTHER_DIVISION);

    const d = new Date(date);
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    const opening = Math.round((await openingBalance(employee, doctor, monthStart)) * 100) / 100;

    // current system: prescription entry lines (their bonus comes from the Bonuses page).
    // The employee's own lines; for a group manager (who enters no prescriptions) the
    // lines the reps entered for this doctor in this month.
    {
      const { parseMonth, monthWindow } = await import("../../utils/bonuses.js");
      const win = monthWindow(parseMonth(date));
      let lines = await DoctorEntryItem.find({ employee, doctor, period: win })
        .select("drug quota prescription sale coefficient budget totalBudget").populate("drug", "price").lean();
      const own = true; // only the chosen rep's own lines — never another rep's
      if (lines.length) {
        let rx = 0, sales = 0, pay = 0, target = 0, rxBoxes = 0, planBoxes = 0;
        for (const it of lines) {
          rxBoxes += it.prescription || 0;
          planBoxes += it.quota || 0;
          const price = it.drug?.price || 0;
          const sold = (it.coefficient || 0) > 0 ? (it.prescription || 0) * it.coefficient : it.sale || 0;
          rx += (it.prescription || 0) * price;
          sales += sold * price;
          pay += it.totalBudget || sold * (it.budget || 0);
          target += (it.quota || 0) * price;
        }
        const now = new Date();
        const lastBudget = await Budget.findOne({
          doctor,
          employee,
          date: { $gte: new Date(now.getFullYear(), 0, 1), $lte: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999) },
        }).sort({ createdAt: -1 }).lean();
        const r2 = (n) => Math.round((n || 0) * 100) / 100;
        return res.json({
          prescriptionAmt: r2(rx),
          salesAmount: r2(sales),
          payableAmt: r2(pay),
          targetAmount: r2(target),
          advanceAmount: r2(lastBudget?.advanceAmount),
          openingBalance: opening,
          entry: { own, lines: lines.length, rxBoxes: r2(rxBoxes), planBoxes: r2(planBoxes) },
        });
      }
    }

    const { default: Prescription } = await import("../../models/Prescription.js");
    const { default: DrugPrescription } = await import("../../models/DrugPrescription.js");
    const { default: DoctorTarget } = await import("../../models/DoctorTarget.js");
    const { default: MedicineTarget } = await import("../../models/MedicineTarget.js");

    const prescriptions = await Prescription.find({
      doctor,
      employee,
      date: { $gte: monthStart, $lte: monthEnd },
    }).select("_id").lean();
    const prescriptionIds = prescriptions.map((p) => p._id);

    const items = await DrugPrescription.find({
      prescription: { $in: prescriptionIds },
    }).populate("drug", "price bonus").lean();

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
    }).select("_id").lean();
    const targetRows = await MedicineTarget.find({
      medicineTargatableType: "DoctorTarget",
      medicineTargatableId: { $in: doctorTargets.map((t) => t._id) },
    }).populate("drug", "price").lean();
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
    }).sort({ createdAt: -1 }).lean();
    const advanceAmount = lastBudget?.advanceAmount || 0;

    res.json({
      prescriptionAmt: Math.round(prescriptionAmt * 100) / 100,
      salesAmount: Math.round(salesAmount * 100) / 100,
      payableAmt: Math.round(payableAmt * 100) / 100,
      targetAmount: Math.round(targetAmount * 100) / 100,
      advanceAmount: Math.round(advanceAmount * 100) / 100,
      openingBalance: opening,
      entry: {
        own: true,
        legacy: true,
        lines: items.length + targetRows.length,
        rxBoxes: Math.round(items.reduce((s, i) => s + (i.totalNoOfBoxes || 0), 0) * 100) / 100,
        planBoxes: Math.round(targetRows.reduce((s, t) => s + (t.totalNoOfBoxes || 0), 0) * 100) / 100,
      },
    });
  } catch (err) {
    console.error("computeBudgetAmounts failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
