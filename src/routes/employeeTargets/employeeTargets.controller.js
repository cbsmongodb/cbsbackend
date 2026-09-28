import EmployeeTarget from "../../models/EmployeeTarget.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import Employee from "../../models/Employee.js";
import Drug from "../../models/Drug.js";
import { getVisibleDrugIds } from "../../utils/groupVisibility.js";

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


// GET /api/employee-targets/visible-drugs — drugs the manager may target
export async function getVisibleDrugsForTarget(req, res) {
  try {
    const isAdmin = req.employee?.role?.name?.toLowerCase() === "admin";
    let filter = {};
    if (!isAdmin) {
      const visibleIds = await getVisibleDrugIds(req.employee);
      filter._id = { $in: visibleIds };
    }
    const drugs = await Drug.find(filter).select("name price").sort({ name: 1 });
    res.json(drugs);
  } catch (err) {
    console.error("getVisibleDrugsForTarget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/employee-targets
// body: { employee, date, items: [{ drug, totalNoOfBoxes }] }
export async function createEmployeeTarget(req, res) {
  try {
    const { employee, date, items } = req.body;
    if (!employee || !date) {
      return res.status(400).json({ error: "employee and date are required" });
    }
    const list = Array.isArray(items) ? items.filter((i) => i.drug && Number(i.totalNoOfBoxes) > 0) : [];
    if (list.length === 0) {
      return res.status(400).json({ error: "at least one drug with boxes is required" });
    }

    const target = await EmployeeTarget.create({ employee, date: new Date(date) });

    const rows = list.map((i) => ({
      medicineTargatableType: "EmployeeTarget",
      medicineTargatableId: target._id,
      drug: i.drug,
      totalNoOfBoxes: Number(i.totalNoOfBoxes),
    }));
    await MedicineTarget.insertMany(rows);

    res.json({ _id: target._id, ok: true });
  } catch (err) {
    console.error("createEmployeeTarget failed:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}


// GET /api/employee-targets/:id — one target with its drug rows (for editing)
export async function getEmployeeTargetById(req, res) {
  try {
    const target = await EmployeeTarget.findById(req.params.id)
      .populate("employee", "firstName lastName name");
    if (!target) return res.status(404).json({ error: "Not found" });

    const rows = await MedicineTarget.find({
      medicineTargatableType: "EmployeeTarget",
      medicineTargatableId: target._id,
    }).populate("drug", "name price");

    res.json({
      _id: target._id,
      date: target.date,
      employee: target.employee?._id || target.employee,
      items: rows.map((r) => ({
        drug: r.drug?._id || r.drug,
        drugName: r.drug?.name || "",
        totalNoOfBoxes: r.totalNoOfBoxes,
      })),
    });
  } catch (err) {
    console.error("getEmployeeTargetById failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// PUT /api/employee-targets/:id — full update (header + drug rows replaced)
export async function updateEmployeeTarget(req, res) {
  try {
    const { employee, date, items } = req.body;
    if (!employee || !date) {
      return res.status(400).json({ error: "employee and date are required" });
    }
    const list = Array.isArray(items) ? items.filter((i) => i.drug && Number(i.totalNoOfBoxes) > 0) : [];
    if (list.length === 0) {
      return res.status(400).json({ error: "at least one drug with boxes is required" });
    }

    const target = await EmployeeTarget.findByIdAndUpdate(
      req.params.id,
      { employee, date: new Date(date) },
      { new: true }
    );
    if (!target) return res.status(404).json({ error: "Not found" });

    await MedicineTarget.deleteMany({
      medicineTargatableType: "EmployeeTarget",
      medicineTargatableId: target._id,
    });
    const rows = list.map((i) => ({
      medicineTargatableType: "EmployeeTarget",
      medicineTargatableId: target._id,
      drug: i.drug,
      totalNoOfBoxes: Number(i.totalNoOfBoxes),
    }));
    await MedicineTarget.insertMany(rows);

    res.json({ _id: target._id, ok: true });
  } catch (err) {
    console.error("updateEmployeeTarget failed:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}
