import Prescription from "../../models/Prescription.js";
import DrugPrescription from "../../models/DrugPrescription.js";
import Drug from "../../models/Drug.js";
import Order from "../../models/Order.js";

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
