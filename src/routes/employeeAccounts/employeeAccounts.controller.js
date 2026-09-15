import EmployeeAccount from "../../models/EmployeeAccount.js";
import Employee from "../../models/Employee.js";

// GET /api/employee-accounts?search=&employee=&fromDate=&toDate=&page=&limit=
export async function getAllEmployeeAccounts(req, res) {
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
      EmployeeAccount.find(filter)
        .populate("employee", "firstName lastName")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limitNum),
      EmployeeAccount.countDocuments(filter),
    ]);

    const rows = docs.map((d) => ({
      _id: d._id,
      date: d.date,
      employeeName: d.employee?.name || "—",
      targetAmount: Math.round((d.targetAmount || 0) * 100) / 100,
      sale: Math.round((d.sale || 0) * 100) / 100,
      percentAchieved: Math.round((d.percentAchieved || 0) * 100) / 100,
    }));

    res.json({
      docs: rows,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAllEmployeeAccounts failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteEmployeeAccount(req, res) {
  try {
    const deleted = await EmployeeAccount.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteEmployeeAccount failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
