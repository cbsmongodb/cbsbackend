import Budget from "../../models/Budget.js";
import Employee from "../../models/Employee.js";
import Doctor from "../../models/Doctor.js";
import Group from "../../models/Group.js";
import { applyEmployeeScope, canSeeEmployee } from "../../utils/groupVisibility.js";
import { syncIssuedBudgetSafe, monthOfDate } from "../../utils/budgetSync.js";
import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import "../../models/Drug.js";

// fromEntries: amounts the budget row shows, worked out from what the rep
// entered on "Prescription entry" for that employee + doctor + month:
//   prescription = Σ prescriptions × drug price
//   sales        = Σ prescriptions × drug price × coefficient (real pharmacy sales / prescriptions)
//   target       = Σ doctor plan × drug price
//   payable      = the doctor's planned budget
// A number stored on the budget itself (e.g. imported from the old CRM) wins.
const ymKey = (d) => { const m = monthOfDate(d); return `${m.y}-${m.m}`; };
async function amountsFromEntries(docs) {
  const out = new Map();
  const withDate = docs.filter((d) => d.date && d.employee && d.doctor);
  if (!withDate.length) return out;
  const times = withDate.map((d) => +new Date(d.date));
  const from = new Date(Math.min(...times) - 40 * 86400000);
  const to = new Date(Math.max(...times) + 40 * 86400000);
  const items = await DoctorEntryItem.find({
    employee: { $in: [...new Set(withDate.map((d) => String(d.employee._id || d.employee)))] },
    doctor: { $in: [...new Set(withDate.map((d) => String(d.doctor._id || d.doctor)))] },
    period: { $gte: from, $lte: to },
  }).select("employee doctor period quota prescription coefficient plannedBudget drug").populate("drug", "price").lean();
  for (const i of items) {
    const k = `${i.employee}|${i.doctor}|${ymKey(i.period)}`;
    const a = out.get(k) || { prescriptionAmt: 0, salesAmount: 0, targetAmount: 0, payableAmt: 0 };
    const price = i.drug?.price || 0;
    a.prescriptionAmt += (i.prescription || 0) * price;
    a.salesAmount += (i.prescription || 0) * price * (i.coefficient || 0);
    a.targetAmount += (i.quota || 0) * price;
    a.payableAmt = Math.max(a.payableAmt, i.plannedBudget || 0);
    out.set(k, a);
  }
  return out;
}

// GET /api/budgets-list?search=&doctor=&employee=&section=&group=&fromDate=&toDate=&isActive=&page=&limit=
export async function getAllBudgets(req, res) {
  try {
    const { search, doctor, employee, section, group, fromDate, toDate, page, limit } = req.query;
    const isActive = req.query.isActive === undefined ? true : req.query.isActive === "true";

    const filter = { isActive };
    if (doctor) filter.doctor = doctor;
    if (employee) filter.employee = employee;
    if (section) filter.section = section;
    if (group) filter.group = group;
    if (fromDate && toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      filter.date = { $gte: new Date(fromDate), $lte: to };
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const [matchingDoctors, matchingEmployees] = await Promise.all([
        Doctor.find({ $or: [{ firstName: regex }, { lastName: regex }, { uniqueNumber: regex }] }).distinct("_id"),
        Employee.find({ $or: [{ firstName: regex }, { lastName: regex }] }).distinct("_id"),
      ]);
      filter.$or = [
        { doctor: { $in: matchingDoctors } },
        { employee: { $in: matchingEmployees } },
      ];
    }

    // everyone sees only their own division / group / self (admin, director, finance: all)
    await applyEmployeeScope(req.employee, filter);

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      Budget.find(filter)
        .populate("employee", "firstName lastName")
        .populate({
          path: "doctor",
          select: "firstName lastName uniqueNumber isBudgeted profile hospitals",
          populate: [
            { path: "profile", select: "name" },
            { path: "hospitals.hospital", select: "name" },
          ],
        })
        .populate("section", "name")
        .populate("group", "name")
        .populate("region", "name")
        .sort({ date: -1 })
        .skip(skip)
        .limit(limitNum).lean(),
      Budget.countDocuments(filter),
    ]);

    const calc = await amountsFromEntries(docs);
    const pick = (d, field) => {
      if (d[field]) return d[field];
      if (!d.date || !d.employee || !d.doctor) return 0;
      const a = calc.get(`${d.employee._id || d.employee}|${d.doctor._id || d.doctor}|${ymKey(d.date)}`);
      return a ? a[field] : 0;
    };
    const rows = docs.map((d) => ({
      _id: d._id,
      date: d.date,
      doctorName: d.doctor?.name || "—",
      doctorIsBudgeted: !!d.doctor?.isBudgeted,
      profileName: d.doctor?.profile?.name || "—",
      uniqueNumber: d.doctor?.uniqueNumber || "—",
      hospitals: (d.doctor?.hospitals || []).map((h) => h.hospital?.name).filter(Boolean).join(", ") || "—",
      employeeName: d.employee?.name || "—",
      sectionName: d.section?.name || "—",
      groupName: d.group?.name || "—",
      regionName: d.region?.name || "—",
      payableAmt: Math.round(pick(d, "payableAmt") * 100) / 100,
      paidAmount: Math.round((d.paidAmount || 0) * 100) / 100,
      advanceAmount: Math.round((d.advanceAmount || 0) * 100) / 100,
      targetAmount: Math.round(pick(d, "targetAmount") * 100) / 100,
      prescriptionAmt: Math.round(pick(d, "prescriptionAmt") * 100) / 100,
      salesAmount: Math.round(pick(d, "salesAmount") * 100) / 100,
      isActive: d.isActive,
    }));

    res.json({
      docs: rows,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAllBudgets failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function toggleBudgetActive(req, res) {
  try {
    const budget = await Budget.findById(req.params.id);
    if (!budget) return res.status(404).json({ error: "Not found" });
    if (!(await canSeeEmployee(req.employee, budget.employee))) {
      return res.status(403).json({ error: "ეს ბიუჯეტი სხვა დივიზიონს ეკუთვნის" });
    }
    budget.isActive = !budget.isActive;
    await budget.save();
    await syncIssuedBudgetSafe(budget);
    res.json(budget);
  } catch (err) {
    console.error("toggleBudgetActive failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteBudget(req, res) {
  try {
    const budget = await Budget.findById(req.params.id).select("employee doctor date").lean();
    if (!budget) return res.status(404).json({ error: "Not found" });
    if (!(await canSeeEmployee(req.employee, budget.employee))) {
      return res.status(403).json({ error: "ეს ბიუჯეტი სხვა დივიზიონს ეკუთვნის" });
    }
    await Budget.findByIdAndDelete(req.params.id);
    await syncIssuedBudgetSafe(budget);
    res.json({ success: true });
  } catch (err) {
    console.error("deleteBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
