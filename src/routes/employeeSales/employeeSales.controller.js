import EmployeeSale from "../../models/EmployeeSale.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import Employee from "../../models/Employee.js";
import { getVisibleDrugIds, seesEverything } from "../../utils/groupVisibility.js";
import Drug from "../../models/Drug.js";
import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import { recalculateForPeriod } from "../sales/doctorEntryItems.controller.js";

// refreshCoefficients: pharmacy sales decide the coefficient (real sales /
// prescriptions) on Prescription entry — so after a sale is added, changed or
// deleted, that employee's month is recalculated right away (coefficient,
// budgets, sales amounts on the Budgets page)
async function refreshCoefficients(employee, date) {
  try {
    if (!employee || !date) return;
    const H = 3600 * 1000;
    const d = new Date(new Date(date).getTime() + 4 * H);
    const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const item = await DoctorEntryItem.findOne({
      employee,
      period: { $gte: new Date(Date.UTC(y, m, 1) - 12 * H), $lt: new Date(Date.UTC(y, m + 1, 1) - 12 * H) },
    }).select("period").lean();
    if (item) await recalculateForPeriod(employee, item.period);
  } catch (err) {
    console.error("refreshCoefficients failed:", err);
  }
}

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
        .limit(limitNum).lean(),
      EmployeeSale.countDocuments(filter),
    ]);

    const saleIds = docs.map((d) => d._id);
    const sales = await MedicineTarget.find({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: { $in: saleIds },
    }).populate("drug", "price").lean();

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
    await refreshCoefficients(deleted.employee, deleted.date);
    res.json({ success: true });
  } catch (err) {
    console.error("deleteEmployeeSale failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}


// GET /api/employee-sales/visible-drugs
export async function getVisibleDrugsForSale(req, res) {
  try {
    const isAdmin = seesEverything(req.employee);
    let filter = {};
    if (!isAdmin) {
      const visibleIds = await getVisibleDrugIds(req.employee);
      filter._id = { $in: visibleIds };
    }
    const drugs = await Drug.find(filter).select("name price").sort({ name: 1 }).lean();
    res.json(drugs);
  } catch (err) {
    console.error("getVisibleDrugsForSale failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/employee-sales
export async function createEmployeeSale(req, res) {
  try {
    const { employee, date, items } = req.body;
    if (!employee || !date) return res.status(400).json({ error: "employee and date are required" });
    const list = Array.isArray(items) ? items.filter((i) => i.drug && Number(i.totalNoOfBoxes) > 0) : [];
    if (list.length === 0) return res.status(400).json({ error: "at least one drug with boxes is required" });

    const sale = await EmployeeSale.create({ employee, date: new Date(date) });
    const rows = list.map((i) => ({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: sale._id,
      drug: i.drug,
      totalNoOfBoxes: Number(i.totalNoOfBoxes),
    }));
    await MedicineTarget.insertMany(rows);
    await refreshCoefficients(employee, date);
    res.json({ _id: sale._id, ok: true });
  } catch (err) {
    console.error("createEmployeeSale failed:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

// GET /api/employee-sales/:id
export async function getEmployeeSaleById(req, res) {
  try {
    const sale = await EmployeeSale.findById(req.params.id).populate("employee", "firstName lastName name").lean();
    if (!sale) return res.status(404).json({ error: "Not found" });
    const rows = await MedicineTarget.find({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: sale._id,
    }).populate("drug", "name price").lean();
    res.json({
      _id: sale._id,
      date: sale.date,
      employee: sale.employee?._id || sale.employee,
      items: rows.map((r) => ({
        drug: r.drug?._id || r.drug,
        drugName: r.drug?.name || "",
        totalNoOfBoxes: r.totalNoOfBoxes,
      })),
    });
  } catch (err) {
    console.error("getEmployeeSaleById failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// PUT /api/employee-sales/:id
export async function updateEmployeeSale(req, res) {
  try {
    const { employee, date, items } = req.body;
    if (!employee || !date) return res.status(400).json({ error: "employee and date are required" });
    const list = Array.isArray(items) ? items.filter((i) => i.drug && Number(i.totalNoOfBoxes) > 0) : [];
    if (list.length === 0) return res.status(400).json({ error: "at least one drug with boxes is required" });

    const before = await EmployeeSale.findById(req.params.id).select("employee date").lean();
    const sale = await EmployeeSale.findByIdAndUpdate(req.params.id, { employee, date: new Date(date) }, { new: true });
    if (!sale) return res.status(404).json({ error: "Not found" });

    await MedicineTarget.deleteMany({ medicineTargatableType: "EmployeeSale", medicineTargatableId: sale._id });
    const rows = list.map((i) => ({
      medicineTargatableType: "EmployeeSale",
      medicineTargatableId: sale._id,
      drug: i.drug,
      totalNoOfBoxes: Number(i.totalNoOfBoxes),
    }));
    await MedicineTarget.insertMany(rows);
    await refreshCoefficients(employee, date);
    if (before && (String(before.employee) !== String(employee) || +new Date(before.date) !== +new Date(date))) {
      await refreshCoefficients(before.employee, before.date);
    }
    res.json({ _id: sale._id, ok: true });
  } catch (err) {
    console.error("updateEmployeeSale failed:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}
