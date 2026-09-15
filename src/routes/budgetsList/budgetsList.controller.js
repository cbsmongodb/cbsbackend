import Budget from "../../models/Budget.js";
import Employee from "../../models/Employee.js";
import Doctor from "../../models/Doctor.js";
import Group from "../../models/Group.js";

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
        .limit(limitNum),
      Budget.countDocuments(filter),
    ]);

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
      payableAmt: Math.round((d.payableAmt || 0) * 100) / 100,
      paidAmount: Math.round((d.paidAmount || 0) * 100) / 100,
      advanceAmount: Math.round((d.advanceAmount || 0) * 100) / 100,
      targetAmount: Math.round((d.targetAmount || 0) * 100) / 100,
      prescriptionAmt: Math.round((d.prescriptionAmt || 0) * 100) / 100,
      salesAmount: Math.round((d.salesAmount || 0) * 100) / 100,
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
    budget.isActive = !budget.isActive;
    await budget.save();
    res.json(budget);
  } catch (err) {
    console.error("toggleBudgetActive failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteBudget(req, res) {
  try {
    const deleted = await Budget.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteBudget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
