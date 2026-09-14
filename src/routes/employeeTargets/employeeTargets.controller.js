import EmployeeTarget from "../../models/EmployeeTarget.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import Employee from "../../models/Employee.js";

// GET /api/employee-targets?search=&employee=&fromDate=&toDate=&page=&limit=
export async function getAllEmployeeTargets(req, res) {
  try {
    const { search, employee, fromDate, toDate, page, limit } = req.query;

    const filter = {};
    if (employee) filter.employee = employee;
    if (fromDate && toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      filter.date = { $gte: new Date(fromDate), $lte: to };
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const matchingEmployees = await Employee.find({
        $or: [{ firstName: regex }, { lastName: regex }],
      }).distinct("_id");
      filter.employee = filter.employee || { $in: matchingEmployees };
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      EmployeeTarget.find(filter)
        .populate("employee", "firstName lastName")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limitNum),
      EmployeeTarget.countDocuments(filter),
    ]);

    const targetIds = docs.map((d) => d._id);
    const targets = await MedicineTarget.find({
      medicineTargatableType: "EmployeeTarget",
      medicineTargatableId: { $in: targetIds },
    }).populate("drug", "price");

    const amountByTarget = new Map();
    targets.forEach((t) => {
      const key = String(t.medicineTargatableId);
      const amount = (t.totalNoOfBoxes || 0) * (t.drug?.price || 0);
      amountByTarget.set(key, (amountByTarget.get(key) || 0) + amount);
    });

    const rows = docs.map((d) => ({
      _id: d._id,
      date: d.date,
      employeeName: d.employee?.name || "—",
      targetAmount: Math.round((amountByTarget.get(String(d._id)) || 0) * 100) / 100,
    }));

    res.json({
      docs: rows,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAllEmployeeTargets failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteEmployeeTarget(req, res) {
  try {
    await MedicineTarget.deleteMany({
      medicineTargatableType: "EmployeeTarget",
      medicineTargatableId: req.params.id,
    });
    const deleted = await EmployeeTarget.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteEmployeeTarget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
