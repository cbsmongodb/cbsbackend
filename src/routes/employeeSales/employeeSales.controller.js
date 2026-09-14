import EmployeeSale from "../../models/EmployeeSale.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import Employee from "../../models/Employee.js";

// GET /api/employee-sales?search=&employee=&fromDate=&toDate=&page=&limit=
export async function getAllEmployeeSales(req, res) {
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
      EmployeeSale.find(filter)
        .populate("employee", "firstName lastName")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limitNum),
      EmployeeSale.countDocuments(filter),
    ]);

    const saleIds = docs.map((d) => d._id);
    const sales = await MedicineTarget.find({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: { $in: saleIds },
    }).populate("drug", "price");

    const amountBySale = new Map();
    sales.forEach((s) => {
      const key = String(s.medicineTargatableId);
      const amount = (s.totalNoOfBoxes || 0) * (s.drug?.price || 0);
      amountBySale.set(key, (amountBySale.get(key) || 0) + amount);
    });

    const rows = docs.map((d) => ({
      _id: d._id,
      date: d.date,
      employeeName: d.employee?.name || "—",
      saleAmount: Math.round((amountBySale.get(String(d._id)) || 0) * 100) / 100,
    }));

    res.json({
      docs: rows,
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
    await MedicineTarget.deleteMany({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: req.params.id,
    });
    const deleted = await EmployeeSale.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteEmployeeSale failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
