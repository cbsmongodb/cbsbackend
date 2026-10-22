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
    const items = await DoctorEntryItem.find(itemFilter).select("employee doctor drug period prescription").populate("drug", "name price");

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
    const sales = await EmployeeSale.find(saleFilter).select("employee date");
    const saleById = new Map(sales.map((s) => [String(s._id), s]));
    const lines = sales.length
      ? await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((s) => s._id) } })
          .select("medicineTargatableId drug totalNoOfBoxes")
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
    const allDocs = await Doctor.find(doctorFilter).populate("profile", "name");
    const r2 = (n) => Math.round(n * 100) / 100;
    const rows = allDocs.map((doc) => {
      const d = byDoctor.get(String(doc._id));
      return {
        _id: doc._id,
        name: doc.name,
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
    const priceById = new Map((await Drug.find({}).select("price")).map((x) => [String(x._id), x.price || 0]));
    const allSections = await Section.find({ name: /^\d\s*DIVIZION/i });
    const divisionSummary = await Promise.all(allSections.map(async (sec) => {
      const gids = await Group.find({ section: sec._id }).distinct("_id");
      const eids = (await Employee.find({ group: { $in: gids } }).distinct("_id")).map(String);
      if (sec.head) eids.push(String(sec.head));
      const set = new Set(eids);
      const ds = await EmployeeSale.find({ employee: { $in: eids }, date: { $gte: new Date(monthFrom.getTime() - 12 * 3600e3), $lte: toDate } }).select("_id");
      const dl = ds.length ? await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: ds.map((x) => x._id) } }).select("drug totalNoOfBoxes") : [];
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

    const year = Number(req.query.year) || new Date(Date.now() + 4 * 3600e3).getUTCFullYear();
    const from = new Date(`${year}-01-01T00:00:00+04:00`);
    const to = new Date(`${year + 1}-01-01T00:00:00+04:00`);
    const monthOf = (d) => new Date(new Date(d).getTime() + 12 * 3600e3).getUTCMonth(); // 0..11, Georgian
    const scope = await getScopeEmployeeIds(req.employee);
    const scopeFilter = scope ? { $in: scope } : undefined;
    const r2 = (n) => Math.round((n || 0) * 100) / 100;

    // who belongs to which division
    const sections = await Section.find({ name: /DIVIZION/i }).select("name head");
    const groups = await Group.find({}).select("section");
    const groupDiv = new Map(groups.map((g) => [String(g._id), String(g.section || "")]));
    const secName = new Map(sections.map((x) => [String(x._id), x.name]));
    const emps = await Employee.find({}).select("firstName lastName group isActive");
    const empDiv = new Map();
    const empName = new Map();
    emps.forEach((e) => {
      empName.set(String(e._id), `${e.firstName || ""} ${e.lastName || ""}`.trim());
      const sid = groupDiv.get(String(e.group || ""));
      empDiv.set(String(e._id), secName.get(sid) || null);
    });
    sections.forEach((x) => { if (x.head) empDiv.set(String(x.head), x.name); });

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `${year}-${String(i + 1).padStart(2, "0")}`,
      sales: 0, boxes: 0, visits: 0, doctorVisits: 0, prescriptions: 0, plannedBudget: 0, byDivision: {},
    }));

    // 1) real sales from pharmacies
    const prices = new Map((await Drug.find({}).select("name price")).map((d) => [String(d._id), d]));
    const saleFilter = { date: { $gte: new Date(from.getTime() - 12 * 3600e3), $lt: new Date(to.getTime() - 12 * 3600e3) } };
    if (scopeFilter) saleFilter.employee = scopeFilter;
    const sales = await EmployeeSale.find(saleFilter).select("employee date");
    const saleById = new Map(sales.map((x) => [String(x._id), x]));
    const lines = sales.length
      ? await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((x) => x._id) } }).select("medicineTargatableId drug totalNoOfBoxes")
      : [];
    const divTotals = new Map(), drugTotals = new Map(), repTotals = new Map();
    lines.forEach((l) => {
      const sale = saleById.get(String(l.medicineTargatableId));
      if (!sale) return;
      const drug = prices.get(String(l.drug));
      const boxes = l.totalNoOfBoxes || 0;
      const amount = boxes * (drug?.price || 0);
      const m = months[monthOf(sale.date)];
      m.sales += amount; m.boxes += boxes;
      const div = empDiv.get(String(sale.employee)) || "—";
      m.byDivision[div] = (m.byDivision[div] || 0) + amount;
      divTotals.set(div, (divTotals.get(div) || 0) + amount);
      const dk = drug?.name || "—";
      const dt = drugTotals.get(dk) || { name: dk, amount: 0, boxes: 0 };
      dt.amount += amount; dt.boxes += boxes; drugTotals.set(dk, dt);
      const rk = String(sale.employee);
      repTotals.set(rk, (repTotals.get(rk) || 0) + amount);
    });

    // 2) visits (completed) + doctors seen
    const planFilter = { period: { $gte: from, $lt: to }, status: { $in: ["i_went", "i_left", "completed"] } };
    if (scopeFilter) planFilter.performer = scopeFilter;
    const plans = await PlanConfiguration.find(planFilter).select("_id period").lean();
    const planMonth = new Map(plans.map((x) => [String(x._id), monthOf(x.period)]));
    plans.forEach((x) => { months[monthOf(x.period)].visits += 1; });
    if (plans.length) {
      const counts = await PlanConfigurationDoctor.aggregate([
        { $match: { planConfiguration: { $in: plans.map((x) => x._id) } } },
        { $group: { _id: "$planConfiguration", n: { $sum: 1 } } },
      ]);
      counts.forEach((c) => { const mi = planMonth.get(String(c._id)); if (mi !== undefined) months[mi].doctorVisits += c.n; });
    }

    // 3) prescriptions + doctors' budgets (data entry)
    const deMatch = { period: { $gte: new Date(Date.UTC(year, 0, 1) - 86400000), $lt: new Date(Date.UTC(year + 1, 0, 1) - 86400000) } };
    if (scope) deMatch.employee = { $in: scope.map((id) => (typeof id === "string" ? new (Doctor.base.Types.ObjectId)(id) : id)) };
    const de = await DoctorEntryItem.aggregate([
      { $match: deMatch },
      { $group: { _id: { $month: { date: "$period", timezone: "+04:00" } }, rx: { $sum: "$prescription" }, budget: { $sum: "$totalBudget" } } },
    ]);
    de.forEach((x) => { const m = months[(x._id || 1) - 1]; if (m) { m.prescriptions += x.rx || 0; m.plannedBudget += x.budget || 0; } });

    months.forEach((m) => {
      m.sales = r2(m.sales); m.plannedBudget = r2(m.plannedBudget);
      Object.keys(m.byDivision).forEach((k) => { m.byDivision[k] = r2(m.byDivision[k]); });
    });
    const sum = (k) => months.reduce((a, m) => a + (m[k] || 0), 0);
    res.json({
      year,
      months,
      divisions: [...divTotals.entries()].map(([name, amount]) => ({ name, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
      topDrugs: [...drugTotals.values()].sort((a, b) => b.amount - a.amount).slice(0, 10).map((d) => ({ ...d, amount: r2(d.amount) })),
      topReps: [...repTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, amount]) => ({ name: empName.get(id) || "—", amount: r2(amount) })),
      totals: {
        sales: r2(sum("sales")), boxes: sum("boxes"), visits: sum("visits"), doctorVisits: sum("doctorVisits"),
        prescriptions: sum("prescriptions"), plannedBudget: r2(sum("plannedBudget")),
        activeEmployees: emps.filter((e) => e.isActive !== false && (!scope || scope.map(String).includes(String(e._id)))).length,
      },
    });
  } catch (err) {
    console.error("getOverview failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
