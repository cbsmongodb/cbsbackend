import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import EmployeeSale from "../../models/EmployeeSale.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import Budget from "../../models/Budget.js";
import Drug from "../../models/Drug.js";
import "../../models/Doctor.js";
import "../../models/Employee.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";

const FINANCE_ROLES = new Set(["finance manager", "admin", "director", "accountant's assistant", "office"]);
const r2 = (n) => Math.round((n || 0) * 100) / 100;
const name = (p) => (p ? `${p.firstName || ""} ${p.lastName || ""}`.trim() : "—");

// a Georgian calendar month: [first day 00:00 +04, next month 00:00 +04)
function georgianMonth(y, m) {
  const pad = (n) => String(n).padStart(2, "0");
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return [new Date(`${y}-${pad(m)}-01T00:00:00+04:00`), new Date(`${ny}-${pad(nm)}-01T00:00:00+04:00`)];
}

async function pharmacySalesAmount(y, m, scope, prices) {
  const [from, to] = georgianMonth(y, m);
  const filter = { date: { $gte: new Date(from.getTime() - 12 * 3600e3), $lt: new Date(to.getTime() - 12 * 3600e3) } };
  if (scope) filter.employee = { $in: scope };
  const sales = await EmployeeSale.find(filter).select("_id");
  if (!sales.length) return { amount: 0, boxes: 0 };
  const lines = await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((s) => s._id) } })
    .select("drug totalNoOfBoxes");
  let amount = 0, boxes = 0;
  lines.forEach((l) => { boxes += l.totalNoOfBoxes || 0; amount += (l.totalNoOfBoxes || 0) * (prices.get(String(l.drug)) || 0); });
  return { amount: r2(amount), boxes };
}

// GET /api/finance/summary?month=YYYY-MM
export async function getFinanceSummary(req, res) {
  try {
    if (!FINANCE_ROLES.has((req.employee?.role?.name || "").toLowerCase().trim())) {
      return res.status(403).json({ error: "Not allowed" });
    }
    const now = new Date(Date.now() + 4 * 3600e3);
    const [y, m] = /^\d{4}-\d{2}$/.test(String(req.query.month || ""))
      ? req.query.month.split("-").map(Number)
      : [now.getUTCFullYear(), now.getUTCMonth() + 1];
    const scope = await getScopeEmployeeIds(req.employee);
    const prices = new Map((await Drug.find({}).select("price")).map((d) => [String(d._id), d.price || 0]));

    // doctors' budgets for the month (Data Entry): planned = sum of the drugs' totals, issued = what was paid
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const itemFilter = { period: { $gte: new Date(monthStart.getTime() - 86400000), $lte: new Date(monthStart.getTime() + 86400000) } };
    if (scope) itemFilter.employee = { $in: scope };
    const items = await DoctorEntryItem.find(itemFilter)
      .select("employee doctor issuedBudget totalBudget bank")
      .populate("doctor", "firstName lastName uniqueNumber")
      .populate("employee", "firstName lastName");
    const byDoctor = new Map();
    items.forEach((it) => {
      const k = `${it.employee?._id}|${it.doctor?._id}`;
      if (!byDoctor.has(k)) byDoctor.set(k, { doctor: it.doctor, employee: it.employee, planned: 0, issued: 0, bank: null });
      const d = byDoctor.get(k);
      d.planned += it.totalBudget || 0;
      d.issued = Math.max(d.issued, it.issuedBudget || 0); // the same doctor-level number sits on every drug row
      if (!d.bank && it.bank) d.bank = it.bank;
    });
    let planned = 0, issued = 0, owed = 0, overpaid = 0, unpaidDoctors = 0;
    const banks = {};
    const debts = [];
    for (const d of byDoctor.values()) {
      planned += d.planned;
      issued += d.issued;
      const diff = d.planned - d.issued;
      if (diff > 0.005) { owed += diff; unpaidDoctors += 1; debts.push(d); }
      if (diff < -0.005) overpaid += -diff;
      if (d.issued > 0) { const b = d.bank || "—"; banks[b] = (banks[b] || 0) + d.issued; }
    }
    debts.sort((a, b) => (b.planned - b.issued) - (a.planned - a.issued));

    // real sales (Sales from pharmacies), this month and the month before
    const cur = await pharmacySalesAmount(y, m, scope, prices);
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    const prev = await pharmacySalesAmount(py, pm, scope, prices);

    // budget payments entered on the Budgets page
    const [bf, bt] = georgianMonth(y, m);
    const bFilter = { date: { $gte: bf, $lt: bt } };
    if (scope) bFilter.employee = { $in: scope };
    const budgets = await Budget.find(bFilter).select("paidAmount");

    res.json({
      month: `${y}-${String(m).padStart(2, "0")}`,
      sales: { amount: cur.amount, boxes: cur.boxes, previousAmount: prev.amount },
      budget: {
        planned: r2(planned),
        issued: r2(issued),
        owed: r2(owed),
        overpaid: r2(overpaid),
        doctors: byDoctor.size,
        unpaidDoctors,
        byBank: Object.entries(banks).map(([bank, amount]) => ({ bank, amount: r2(amount) })).sort((a, b) => b.amount - a.amount),
      },
      payments: { amount: r2(budgets.reduce((s, b) => s + (b.paidAmount || 0), 0)), count: budgets.length },
      topDebts: debts.slice(0, 8).map((d) => ({
        doctor: name(d.doctor),
        uniqueNumber: d.doctor?.uniqueNumber || "",
        employee: name(d.employee),
        planned: r2(d.planned),
        issued: r2(d.issued),
        owed: r2(d.planned - d.issued),
      })),
    });
  } catch (err) {
    console.error("getFinanceSummary failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
