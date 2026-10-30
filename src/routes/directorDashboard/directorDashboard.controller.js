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
    }).populate("drug", "name price stocks monthlyTarget").lean();

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
      openingStocks: Math.round((r.openingStocks || 0) * 100) / 100,
      closingStocks: Math.round(((r.openingStocks || 0) - (r.saleBoxes || 0)) * 100) / 100,
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
      Drug.find({ isActive: true }).select("name stocks").sort({ name: 1 }).lean(),
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
      Order.find().populate("drug", "name").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(),
      Order.find({ createdAt: { $gte: monthStart, $lte: monthEnd } }).select("createdAt").lean(),
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
// GET /api/director-dashboard/doctors-report?fromDate=&toDate=&doctor=&division=&group=&page=&limit=
// Doctors' sales are ESTIMATED: the real sales are only known per rep + drug + month
// ("Sales from pharmacies"); they are shared out over that rep's doctors by their prescriptions:
//   doctor's estimated boxes = doctor's prescriptions x (rep's real sales / rep's prescriptions, all doctors)
// No real sales entered for that rep + drug + month -> unknown (not counted, flagged).
export async function getDoctorsReport(req, res) {
  try {
    const { doctor, division, group, page, limit } = req.query;
    const { default: Employee } = await import("../../models/Employee.js");
    const { default: Group } = await import("../../models/Group.js");
    const { default: Section } = await import("../../models/Section.js");
    const { default: DoctorEntryItem } = await import("../../models/DoctorEntryItem.js");
    const { default: EmployeeSale } = await import("../../models/EmployeeSale.js");
    const { default: MedicineTarget } = await import("../../models/MedicineTarget.js");
    const { getScopeEmployeeIds } = await import("../../utils/groupVisibility.js");

    // whole Georgian days; data entry is monthly, so every month the range touches counts
    const day = (s, end) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))
      ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00"}+04:00`) : null);
    const now = new Date();
    const fromDate = day(req.query.fromDate, false) || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const toDate = day(req.query.toDate, true) || new Date();
    const g = new Date(fromDate.getTime() + 4 * 3600e3);
    const monthFrom = new Date(Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), 1));
    const monthKey = (d) => { const x = new Date(new Date(d).getTime() + 12 * 3600e3); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`; };

    // who is in scope (viewer's visibility + division / group filter)
    let scoped = null;
    if (group) scoped = await Employee.find({ group }).distinct("_id");
    else if (division) {
      const gids = await Group.find({ section: division }).distinct("_id");
      scoped = await Employee.find({ group: { $in: gids } }).distinct("_id");
    }
    const viewer = await getScopeEmployeeIds(req.employee);
    if (viewer) {
      const vs = new Set(viewer.map(String));
      scoped = scoped ? scoped.filter((id) => vs.has(String(id))) : viewer;
    }

    // every data-entry line of the period (all doctors, so the rep's totals are complete)
    const itemFilter = { period: { $gte: monthFrom, $lte: toDate } };
    if (scoped) itemFilter.employee = { $in: scoped };
    const items = await DoctorEntryItem.find(itemFilter).select("employee doctor drug period prescription").populate("drug", "name price").lean();

    // rep's prescriptions per drug + month
    const rxTotal = new Map();
    items.forEach((it) => {
      const k = `${it.employee}|${it.drug?._id}|${monthKey(it.period)}`;
      rxTotal.set(k, (rxTotal.get(k) || 0) + (it.prescription || 0));
    });

    // rep's REAL sales per drug + month
    const empIds = [...new Set(items.map((it) => String(it.employee)))];
    const saleFilter = { date: { $gte: new Date(monthFrom.getTime() - 12 * 3600e3), $lte: toDate } };
    saleFilter.employee = { $in: scoped ? scoped : empIds };
    const sales = await EmployeeSale.find(saleFilter).select("employee date").lean();
    const saleById = new Map(sales.map((s) => [String(s._id), s]));
    const lines = sales.length
      ? await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((s) => s._id) } })
          .select("medicineTargatableId drug totalNoOfBoxes").lean()
      : [];
    const real = new Map();
    lines.forEach((l) => {
      const s = saleById.get(String(l.medicineTargatableId));
      if (!s) return;
      const k = `${s.employee}|${l.drug}|${monthKey(s.date)}`;
      real.set(k, (real.get(k) || 0) + (l.totalNoOfBoxes || 0));
    });

    // per doctor: prescriptions, estimated boxes / amount, per-drug breakdown
    const byDoctor = new Map();
    items.forEach((it) => {
      if (!it.drug) return;
      const k = `${it.employee}|${it.drug._id}|${monthKey(it.period)}`;
      const id = String(it.doctor);
      if (!byDoctor.has(id)) byDoctor.set(id, { rx: 0, boxes: 0, amount: 0, unknown: 0, drugs: new Map() });
      const d = byDoctor.get(id);
      const rx = it.prescription || 0;
      const total = rxTotal.get(k) || 0;
      let est = null;
      if (real.has(k) && total > 0) est = rx * (real.get(k) / total);
      const price = it.drug.price || 0;
      d.rx += rx;
      if (est === null) { if (rx > 0) d.unknown += 1; }
      else { d.boxes += est; d.amount += est * price; }
      const name = it.drug.name || "—";
      const row = d.drugs.get(name) || { drugName: name, prescriptions: 0, saleBoxes: 0, salesAmount: 0, unknown: false };
      row.prescriptions += rx;
      if (est === null) { if (rx > 0) row.unknown = true; }
      else { row.saleBoxes += est; row.salesAmount += est * price; }
      d.drugs.set(name, row);
    });

    // the doctors to list
    const doctorFilter = { _id: { $in: [...byDoctor.keys()] } };
    if (doctor) doctorFilter._id = byDoctor.has(String(doctor)) ? doctor : { $in: [] };
    const allDocs = await Doctor.find(doctorFilter).select("firstName lastName uniqueNumber profile isActive isBudgeted createdAt").populate("profile", "name").lean();
    const r2 = (n) => Math.round(n * 100) / 100;
    const rows = allDocs.map((doc) => {
      const d = byDoctor.get(String(doc._id));
      return {
        _id: doc._id,
        name: [doc.firstName, doc.lastName].filter(Boolean).join(" "),
        uniqueNumber: doc.uniqueNumber,
        profileName: doc.profile?.name || "—",
        isActive: doc.isActive,
        isBudgeted: doc.isBudgeted,
        createdAt: doc.createdAt,
        totalPrescriptions: d.rx,
        totalSaleBoxes: Math.round(d.boxes),
        totalSalesAmount: r2(d.amount),
        unknownLines: d.unknown,
        drugBreakdown: [...d.drugs.values()]
          .map((x) => ({ ...x, saleBoxes: Math.round(x.saleBoxes), salesAmount: r2(x.salesAmount) }))
          .sort((a, b) => b.salesAmount - a.salesAmount || b.prescriptions - a.prescriptions),
      };
    }).sort((a, b) => b.totalSalesAmount - a.totalSalesAmount || b.totalPrescriptions - a.totalPrescriptions);

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 25, 1), 100);
    const docs = rows.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    // revenue by division = the REAL pharmacy sales of the division's reps (no estimate needed)
    const priceById = new Map((await Drug.find({}).select("price").lean()).map((x) => [String(x._id), x.price || 0]));
    const allSections = await Section.find({ name: /^\d\s*DIVIZION/i }).select("name head").lean();
    const divisionSummary = await Promise.all(allSections.map(async (sec) => {
      const gids = await Group.find({ section: sec._id }).distinct("_id");
      const eids = (await Employee.find({ group: { $in: gids } }).distinct("_id")).map(String);
      if (sec.head) eids.push(String(sec.head));
      const set = new Set(eids);
      const ds = await EmployeeSale.find({ employee: { $in: eids }, date: { $gte: new Date(monthFrom.getTime() - 12 * 3600e3), $lte: toDate } }).select("_id").lean();
      const dl = ds.length ? await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: ds.map((x) => x._id) } }).select("drug totalNoOfBoxes").lean() : [];
      const total = dl.reduce((s, l) => s + (l.totalNoOfBoxes || 0) * (priceById.get(String(l.drug)) || 0), 0);
      return { divisionId: sec._id, divisionName: sec.name, totalSalesAmount: r2(total), employees: set.size };
    }));

    res.json({
      docs,
      total: rows.length,
      page: pageNum,
      pages: Math.max(Math.ceil(rows.length / limitNum), 1),
      limit: limitNum,
      kpis: {
        newlyAddedCount: allDocs.filter((x) => x.createdAt >= fromDate && x.createdAt <= toDate).length,
        activeCount: allDocs.filter((x) => x.isActive).length,
        budgetedCount: allDocs.filter((x) => x.isBudgeted).length,
      },
      divisionSummary,
      estimated: true,
    });
  } catch (err) {
    console.error("getDoctorsReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}


// GET /api/director-dashboard/overview?year=2026
// Year at a glance: real sales (pharmacies) per month and division, visits, prescriptions, budgets, top drugs / reps.
// fastOverview: the heavy counting is done inside MongoDB (aggregations instead of
// loading every sale / visit into memory) and the finished answer is kept for a
// few minutes per user scope + year (?fresh=1 forces a new count).
const overviewCache = new Map();
const OVERVIEW_TTL_NOW = 5 * 60 * 1000;      // current year: 5 min
const OVERVIEW_TTL_PAST = 6 * 60 * 60 * 1000; // past years: 6 h

export async function getOverview(req, res) {
  try {
    const { default: Employee } = await import("../../models/Employee.js");
    const { default: Group } = await import("../../models/Group.js");
    const { default: Section } = await import("../../models/Section.js");
    const { default: EmployeeSale } = await import("../../models/EmployeeSale.js");
    const { default: MedicineTarget } = await import("../../models/MedicineTarget.js");
    const { default: DoctorEntryItem } = await import("../../models/DoctorEntryItem.js");
    const { default: PlanConfiguration } = await import("../../models/PlanConfiguration.js");
    const { default: PlanConfigurationDoctor } = await import("../../models/PlanConfigurationDoctor.js");
    const { getScopeEmployeeIds } = await import("../../utils/groupVisibility.js");

    const nowYear = new Date(Date.now() + 4 * 3600e3).getUTCFullYear();
    const year = Number(req.query.year) || nowYear;
    const scope = await getScopeEmployeeIds(req.employee);
    const cacheKey = `${year}|${scope ? [...scope].map(String).sort().join(",") : "all"}`;
    const ttl = year < nowYear ? OVERVIEW_TTL_PAST : OVERVIEW_TTL_NOW;
    const hit = overviewCache.get(cacheKey);
    if (hit && !req.query.fresh && Date.now() - hit.at < ttl) {
      return res.json({ ...(await hit.value), cachedAt: new Date(hit.at).toISOString() });
    }

    const compute = async () => {
      const from = new Date(`${year}-01-01T00:00:00+04:00`);
      const to = new Date(`${year + 1}-01-01T00:00:00+04:00`);
      const HALF = 12 * 3600e3;
      const OID = Doctor.base.Types.ObjectId;
      const scopeIds = scope ? scope.map((id) => (typeof id === "string" ? new OID(id) : id)) : null;
      const r2 = (n) => Math.round((n || 0) * 100) / 100;
      // Georgian month 1..12 of a date field (+12h covers both midnight styles)
      const monthExpr = (field) => ({ $month: { $add: [field, HALF] } });

      // who belongs to which division
      const [sections, groups, emps, drugs] = await Promise.all([
        Section.find({ name: /DIVIZION/i }).select("name head").lean(),
        Group.find({}).select("section").lean(),
        Employee.find({}).select("firstName lastName group isActive").lean(),
        Drug.find({}).select("name price").lean(),
      ]);
      const groupDiv = new Map(groups.map((g) => [String(g._id), String(g.section || "")]));
      const secName = new Map(sections.map((x) => [String(x._id), x.name]));
      const empDiv = new Map();
      const empName = new Map();
      emps.forEach((e) => {
        empName.set(String(e._id), `${e.firstName || ""} ${e.lastName || ""}`.trim());
        empDiv.set(String(e._id), secName.get(groupDiv.get(String(e.group || ""))) || null);
      });
      sections.forEach((x) => { if (x.head) empDiv.set(String(x.head), x.name); });
      const prices = new Map(drugs.map((d) => [String(d._id), d]));

      const months = Array.from({ length: 12 }, (_, i) => ({
        month: `${year}-${String(i + 1).padStart(2, "0")}`,
        sales: 0, boxes: 0, visits: 0, doctorVisits: 0, prescriptions: 0, plannedBudget: 0, byDivision: {},
      }));

      const saleMatch = { date: { $gte: new Date(from.getTime() - HALF), $lt: new Date(to.getTime() - HALF) } };
      if (scopeIds) saleMatch.employee = { $in: scopeIds };
      const planMatch = { period: { $gte: from, $lt: to }, status: { $in: ["i_went", "i_left", "completed"] } };
      if (scopeIds) planMatch.performer = { $in: scopeIds };
      const deMatch = { period: { $gte: new Date(Date.UTC(year, 0, 1) - 86400000), $lt: new Date(Date.UTC(year + 1, 0, 1) - 86400000) } };
      if (scopeIds) deMatch.employee = { $in: scopeIds };

      const [saleRows, visitRows, de] = await Promise.all([
        // 1) real sales from pharmacies: boxes per month + employee + drug
        EmployeeSale.aggregate([
          { $match: saleMatch },
          { $lookup: { from: MedicineTarget.collection.name, localField: "_id", foreignField: "medicineTargatableId", as: "l" } },
          { $unwind: "$l" },
          { $match: { "l.medicineTargatableType": "EmployeeSale" } },
          { $group: { _id: { m: monthExpr("$date"), e: "$employee", d: "$l.drug" }, boxes: { $sum: "$l.totalNoOfBoxes" } } },
        ]).allowDiskUse(true),
        // 2) completed visits + doctors seen, per month
        PlanConfiguration.aggregate([
          { $match: planMatch },
          { $lookup: { from: PlanConfigurationDoctor.collection.name, localField: "_id", foreignField: "planConfiguration", as: "d" } },
          { $group: { _id: monthExpr("$period"), visits: { $sum: 1 }, doctorVisits: { $sum: { $size: "$d" } } } },
        ]).allowDiskUse(true),
        // 3) prescriptions + doctors' budgets (data entry)
        DoctorEntryItem.aggregate([
          { $match: deMatch },
          { $group: { _id: { $month: { date: "$period", timezone: "+04:00" } }, rx: { $sum: "$prescription" }, budget: { $sum: "$totalBudget" } } },
        ]),
      ]);

      const divTotals = new Map(), drugTotals = new Map(), repTotals = new Map();
      saleRows.forEach((r) => {
        const m = months[(r._id.m || 1) - 1];
        if (!m) return;
        const drug = prices.get(String(r._id.d));
        const boxes = r.boxes || 0;
        const amount = boxes * (drug?.price || 0);
        m.sales += amount; m.boxes += boxes;
        const div = empDiv.get(String(r._id.e)) || "—";
        m.byDivision[div] = (m.byDivision[div] || 0) + amount;
        divTotals.set(div, (divTotals.get(div) || 0) + amount);
        const dk = drug?.name || "—";
        const dt = drugTotals.get(dk) || { name: dk, amount: 0, boxes: 0 };
        dt.amount += amount; dt.boxes += boxes; drugTotals.set(dk, dt);
        const rk = String(r._id.e);
        repTotals.set(rk, (repTotals.get(rk) || 0) + amount);
      });
      visitRows.forEach((v) => { const m = months[(v._id || 1) - 1]; if (m) { m.visits += v.visits; m.doctorVisits += v.doctorVisits; } });
      de.forEach((x) => { const m = months[(x._id || 1) - 1]; if (m) { m.prescriptions += x.rx || 0; m.plannedBudget += x.budget || 0; } });

      months.forEach((m) => {
        m.sales = r2(m.sales); m.plannedBudget = r2(m.plannedBudget);
        Object.keys(m.byDivision).forEach((k) => { m.byDivision[k] = r2(m.byDivision[k]); });
      });
      const sum = (k) => months.reduce((a, m) => a + (m[k] || 0), 0);
      const scopeSet = scope ? new Set(scope.map(String)) : null;
      return {
        year,
        months,
        divisions: [...divTotals.entries()].map(([name, amount]) => ({ name, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
        topDrugs: [...drugTotals.values()].sort((a, b) => b.amount - a.amount).slice(0, 10).map((d) => ({ ...d, amount: r2(d.amount) })),
        topReps: [...repTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, amount]) => ({ name: empName.get(id) || "—", amount: r2(amount) })),
        totals: {
          sales: r2(sum("sales")), boxes: sum("boxes"), visits: sum("visits"), doctorVisits: sum("doctorVisits"),
          prescriptions: sum("prescriptions"), plannedBudget: r2(sum("plannedBudget")),
          activeEmployees: emps.filter((e) => e.isActive !== false && (!scopeSet || scopeSet.has(String(e._id)))).length,
        },
      };
    };

    const value = compute();
    const at = Date.now();
    if (overviewCache.size > 200) overviewCache.clear();
    overviewCache.set(cacheKey, { at, value });
    try {
      res.json({ ...(await value), cachedAt: new Date(at).toISOString() });
    } catch (err) {
      overviewCache.delete(cacheKey);
      throw err;
    }
  } catch (err) {
    console.error("getOverview failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
