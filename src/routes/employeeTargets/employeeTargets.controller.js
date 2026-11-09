import EmployeeTarget from "../../models/EmployeeTarget.js";
import { nameSearchFilter } from "../../utils/nameSearch.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import Employee from "../../models/Employee.js";
import Drug from "../../models/Drug.js";
import {
  getVisibleDrugIds,
  seesEverything,
  getScopeEmployeeIds,
  canSeeEmployee,
} from "../../utils/groupVisibility.js";

// managers only see / change targets of their own people
async function targetAllowed(req, id) {
  const t = await EmployeeTarget.findById(id).select("employee").lean();
  if (!t) return "missing";
  return (await canSeeEmployee(req.employee, t.employee)) ? "ok" : "no";
}

// GET /api/employee-targets?search=&employee=&fromDate=&toDate=&page=&limit=
export async function getAllEmployeeTargets(req, res) {
  try {
    const { search, employee, fromDate, toDate, page, limit } = req.query;

    const filter = {};
    if (employee) filter.employee = employee;
    // monthFilter: ?month=YYYY-MM -> that month (+-12h so both midnight styles fit)
    const mm = String(req.query.month || "").match(/^(\d{4})-(\d{2})$/);
    if (mm) {
      const H12 = 12 * 3600e3;
      const y = +mm[1];
      const m = +mm[2] - 1;
      filter.date = {
        $gte: new Date(Date.UTC(y, m, 1) - H12),
        $lt: new Date(Date.UTC(y, m + 1, 1) - H12),
      };
    } else if (fromDate && toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      filter.date = { $gte: new Date(fromDate), $lte: to };
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const matchingEmployees = await Employee.find(nameSearchFilter(search, ["firstName", "lastName"])).distinct("_id");
      filter.employee = filter.employee || { $in: matchingEmployees };
    }

    // scope: managers see only their people's targets
    const scope = await getScopeEmployeeIds(req.employee);
    if (scope) {
      const allowed = new Set(scope.map(String));
      const cur = filter.employee;
      if (!cur) filter.employee = { $in: scope };
      else if (typeof cur === "object" && cur.$in) {
        filter.employee = { $in: cur.$in.filter((x) => allowed.has(String(x))) };
      } else if (!allowed.has(String(cur))) {
        filter.employee = { $in: [] };
      }
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      EmployeeTarget.find(filter)
        .populate("employee", "firstName lastName")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limitNum).lean(),
      EmployeeTarget.countDocuments(filter),
    ]);

    const targetIds = docs.map((d) => d._id);
    const targets = await MedicineTarget.find({
      medicineTargatableType: "EmployeeTarget",
      medicineTargatableId: { $in: targetIds },
    }).populate("drug", "price").lean();

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
    const st = await targetAllowed(req, req.params.id);
    if (st === "missing") return res.status(404).json({ error: "Not found" });
    if (st === "no") return res.status(403).json({ error: "Forbidden" });
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
    const isAdmin = seesEverything(req.employee);
    let filter = {};
    if (!isAdmin) {
      const visibleIds = await getVisibleDrugIds(req.employee);
      filter._id = { $in: visibleIds };
    }
    const drugs = await Drug.find(filter).select("name price").sort({ name: 1 }).lean();
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
    if (!(await canSeeEmployee(req.employee, employee))) {
      return res.status(403).json({ error: "Forbidden" });
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
      .populate("employee", "firstName lastName name").lean();
    if (!target) return res.status(404).json({ error: "Not found" });
    if (!(await canSeeEmployee(req.employee, target.employee))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const rows = await MedicineTarget.find({
      medicineTargatableType: "EmployeeTarget",
      medicineTargatableId: target._id,
    }).populate("drug", "name price").lean();

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
    const st = await targetAllowed(req, req.params.id);
    if (st === "missing") return res.status(404).json({ error: "Not found" });
    if (st === "no" || !(await canSeeEmployee(req.employee, employee))) {
      return res.status(403).json({ error: "Forbidden" });
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
