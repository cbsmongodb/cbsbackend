import Prescription from "../../models/Prescription.js";
import DrugPrescription from "../../models/DrugPrescription.js";
import Drug from "../../models/Drug.js";
import Order from "../../models/Order.js";
import Doctor from "../../models/Doctor.js";

// GET /api/director-dashboard/product-sale?fromDate=&toDate=&page=&limit=
export async function getProductSale(req, res) {
  try {
    const now = new Date();
    const fromDate = req.query.fromDate
      ? new Date(req.query.fromDate)
      : new Date(now.getFullYear(), now.getMonth() - 2, 1);
    const toDate = req.query.toDate
      ? new Date(req.query.toDate)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const prescriptionIds = await Prescription.find({
      date: { $gte: fromDate, $lte: toDate },
    }).distinct("_id");

    const items = await DrugPrescription.find({
      prescription: { $in: prescriptionIds },
    }).populate("drug", "name price stocks monthlyTarget");

    const byDrug = new Map();
    items.forEach((it) => {
      if (!it.drug) return;
      const key = String(it.drug._id);
      const entry = byDrug.get(key) || {
        drugName: it.drug.name,
        openingStocks: it.drug.stocks || 0,
        monthlyTarget: it.drug.monthlyTarget || 0,
        saleBoxes: 0,
        totalSaleAmount: 0,
      };
      const sold = it.saleBoxes || 0;
      entry.saleBoxes += sold;
      entry.totalSaleAmount += sold * (it.drug.price || 0);
      byDrug.set(key, entry);
    });

    let rows = Array.from(byDrug.values()).map((r) => ({
      ...r,
      totalSaleAmount: Math.round(r.totalSaleAmount * 100) / 100,
      closingStocks: r.openingStocks - r.saleBoxes,
    }));
    rows.sort((a, b) => b.totalSaleAmount - a.totalSaleAmount);

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const total = rows.length;
    const start = (page - 1) * limit;
    const docs = rows.slice(start, start + limit);

    res.json({ docs, total, page, pages: Math.max(Math.ceil(total / limit), 1), limit });
  } catch (err) {
    console.error("getProductSale failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/director-dashboard/stock-availability?page=&limit=
export async function getStockAvailability(req, res) {
  try {
    // small enough dataset (a few hundred drugs) to return in full and let
    // the table handle sort/search/pagination client-side — snappier UX
    const [allDrugs, lowStock, expired] = await Promise.all([
      Drug.find({ isActive: true }).select("name stocks").sort({ name: 1 }),
      Drug.checkLowStock(),
      Drug.checkExpiredDrugs(),
    ]);

    const docs = allDrugs.map((d) => ({ name: d.name, stocks: d.stocks }));

    res.json({
      docs,
      total: docs.length,
      lowStock,
      expired,
    });
  } catch (err) {
    console.error("getStockAvailability failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/director-dashboard/orders?page=&limit=
export async function getOrders(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const [docs, total, thisMonthOrders] = await Promise.all([
      Order.find().populate("drug", "name").sort({ createdAt: -1 }).skip(skip).limit(limit),
      Order.countDocuments(),
      Order.find({ createdAt: { $gte: monthStart, $lte: monthEnd } }).select("createdAt"),
    ]);

    const ordersByDay = {};
    thisMonthOrders.forEach((o) => {
      const key = o.createdAt.toISOString().slice(0, 10);
      ordersByDay[key] = (ordersByDay[key] || 0) + 1;
    });

    const rows = docs.map((o) => ({
      _id: o._id,
      drugName: o.drug?.name || "—",
      pack: o.pack,
      priceFobUsd: o.priceFobUsd,
      quantity: o.quantity,
      amountUsd: o.amountUsd,
      createdAt: o.createdAt,
    }));

    res.json({
      docs: rows,
      total,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      limit,
      ordersByDay,
    });
  } catch (err) {
    console.error("getOrders failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/director-dashboard/doctors-report
// ?fromDate=&toDate=&doctor=&division=&group=&page=&limit=
// KPI counts (newly added / active / budgeted) + per-doctor drug sales
// breakdown, scoped by division/group via the employees who prescribed
// to each doctor in the period.
export async function getDoctorsReport(req, res) {
  try {
    const { doctor, division, group, page, limit } = req.query;

    const now = new Date();
    const fromDate = req.query.fromDate ? new Date(req.query.fromDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = req.query.toDate ? new Date(req.query.toDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    toDate.setHours(23, 59, 59, 999);

    const { default: Employee } = await import("../../models/Employee.js");
    const { default: Group } = await import("../../models/Group.js");
    const { default: Prescription } = await import("../../models/Prescription.js");
    const { default: DrugPrescription } = await import("../../models/DrugPrescription.js");

    // resolve which employees are "in scope" for division/group filters
    let scopedEmployeeIds = null;
    if (group) {
      const g = await Group.findById(group).select("members");
      scopedEmployeeIds = g?.members || [];
    } else if (division) {
      scopedEmployeeIds = await Employee.find({ division }).distinct("_id");
    }

    // which doctors have a prescription from an in-scope employee this period
    let doctorIdFilter = null;
    if (scopedEmployeeIds) {
      doctorIdFilter = await Prescription.find({
        employee: { $in: scopedEmployeeIds },
        date: { $gte: fromDate, $lte: toDate },
      }).distinct("doctor");
    }

    const doctorFilter = { isActive: true };
    if (doctor) doctorFilter._id = doctor;
    if (doctorIdFilter) doctorFilter._id = doctorIdFilter.length ? { $in: doctorIdFilter } : { $in: [] };

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [doctors, total, activeCount, budgetedCount, newlyAddedCount] = await Promise.all([
      Doctor.find(doctorFilter).populate("profile", "name").sort({ firstName: 1 }).skip(skip).limit(limitNum),
      Doctor.countDocuments(doctorFilter),
      Doctor.countDocuments({ ...doctorFilter, isActive: true }),
      Doctor.countDocuments({ ...doctorFilter, isBudgeted: true }),
      Doctor.countDocuments({ ...doctorFilter, createdAt: { $gte: fromDate, $lte: toDate } }),
    ]);

    const docs = await Promise.all(
      doctors.map(async (d) => {
        const prescriptionFilter = {
          doctor: d._id,
          date: { $gte: fromDate, $lte: toDate },
        };
        if (scopedEmployeeIds) prescriptionFilter.employee = { $in: scopedEmployeeIds };

        const prescriptions = await Prescription.find(prescriptionFilter).select("_id");
        const items = await DrugPrescription.find({
          prescription: { $in: prescriptions.map((p) => p._id) },
        }).populate("drug", "name price");

        let totalSalesAmount = 0;
        let totalSaleBoxes = 0;
        const byDrug = new Map();

        items.forEach((it) => {
          const price = it.drug?.price || 0;
          const sold = it.saleBoxes || 0;
          totalSalesAmount += sold * price;
          totalSaleBoxes += sold;

          const drugName = it.drug?.name || "—";
          const entry = byDrug.get(drugName) || { drugName, saleBoxes: 0, salesAmount: 0 };
          entry.saleBoxes += sold;
          entry.salesAmount += sold * price;
          byDrug.set(drugName, entry);
        });

        return {
          _id: d._id,
          name: d.name,
          uniqueNumber: d.uniqueNumber,
          profileName: d.profile?.name || "—",
          isActive: d.isActive,
          isBudgeted: d.isBudgeted,
          createdAt: d.createdAt,
          totalSalesAmount: Math.round(totalSalesAmount * 100) / 100,
          totalSaleBoxes,
          drugBreakdown: Array.from(byDrug.values())
            .map((x) => ({
              drugName: x.drugName,
              saleBoxes: x.saleBoxes,
              salesAmount: Math.round(x.salesAmount * 100) / 100,
            }))
            .sort((a, b) => b.salesAmount - a.salesAmount),
        };
      })
    );

    res.json({
      docs,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
      kpis: { newlyAddedCount, activeCount, budgetedCount },
    });
  } catch (err) {
    console.error("getDoctorsReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
