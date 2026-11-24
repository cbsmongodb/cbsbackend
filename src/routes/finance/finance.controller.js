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
  const sales = await EmployeeSale.find(filter).select("_id").lean();
  if (!sales.length) return { amount: 0, boxes: 0 };
  const lines = await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((s) => s._id) } })
    .select("drug totalNoOfBoxes").lean();
  let amount = 0, boxes = 0;
  lines.forEach((l) => { boxes += l.totalNoOfBoxes || 0; amount += (l.totalNoOfBoxes || 0) * (prices.get(String(l.drug)) || 0); });
  return { amount: r2(amount), boxes: r2(boxes) };
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
    const prices = new Map((await Drug.find({}).select("price").lean()).map((d) => [String(d._id), d.price || 0]));

    // doctors' budgets for the month (Data Entry): planned = sum of the drugs' totals, issued = what was paid
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const itemFilter = { period: { $gte: new Date(monthStart.getTime() - 86400000), $lte: new Date(monthStart.getTime() + 86400000) } };
    if (scope) itemFilter.employee = { $in: scope };
    const items = await DoctorEntryItem.find(itemFilter)
      .select("employee doctor issuedBudget totalBudget bank")
      .populate("doctor", "firstName lastName uniqueNumber")
      .populate("employee", "firstName lastName").lean();
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
    const budgets = await Budget.find({ ...bFilter, isActive: { $ne: false } }).select("paidAmount").lean();

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

// ---------------------------------------------------------------------------
// GET /api/finance/details?month=YYYY-MM&card=sales|planned|issued|owed|payments
// "where does this number come from": the rows behind every dashboard card,
// their total (must equal the card) and automatic checks for suspicious data.
// Read-only — nothing is changed.
// ---------------------------------------------------------------------------
const CARDS = new Set(["sales", "planned", "issued", "owed", "payments"]);

export async function getFinanceDetails(req, res) {
  try {
    if (!FINANCE_ROLES.has((req.employee?.role?.name || "").toLowerCase().trim())) {
      return res.status(403).json({ error: "Not allowed" });
    }
    const card = String(req.query.card || "");
    if (!CARDS.has(card)) return res.status(400).json({ error: "unknown card" });
    const now = new Date(Date.now() + 4 * 3600e3);
    const [y, m] = /^\d{4}-\d{2}$/.test(String(req.query.month || ""))
      ? req.query.month.split("-").map(Number)
      : [now.getUTCFullYear(), now.getUTCMonth() + 1];
    const scope = await getScopeEmployeeIds(req.employee);
    const drugs = await Drug.find({}).select("name price").lean();
    const drugById = new Map(drugs.map((d) => [String(d._id), d]));
    const checks = [];

    if (card === "sales") {
      const [from, to] = georgianMonth(y, m);
      const filter = { date: { $gte: new Date(from.getTime() - 12 * 3600e3), $lt: new Date(to.getTime() - 12 * 3600e3) } };
      if (scope) filter.employee = { $in: scope };
      const sales = await EmployeeSale.find(filter).select("_id employee date").populate("employee", "firstName lastName").lean();
      const lines = sales.length
        ? await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((s) => s._id) } })
            .select("drug totalNoOfBoxes medicineTargatableId").lean()
        : [];
      const byDrug = new Map();
      let noPrice = 0, noDrug = 0;
      lines.forEach((l) => {
        const d = drugById.get(String(l.drug));
        if (!d) noDrug++;
        const k = String(l.drug);
        const row = byDrug.get(k) || { drug: d?.name || "— წაშლილი წამალი", price: d?.price || 0, boxes: 0, amount: 0 };
        row.boxes += l.totalNoOfBoxes || 0;
        row.amount += (l.totalNoOfBoxes || 0) * (d?.price || 0);
        byDrug.set(k, row);
      });
      byDrug.forEach((r) => { if (r.boxes > 0 && !r.price) noPrice++; });
      const empty = sales.filter((s) => !lines.some((l) => String(l.medicineTargatableId) === String(s._id))).length;
      if (!sales.length) checks.push({ level: "warn", text: "ამ თვეზე აფთიაქების გაყიდვები ჯერ არ არის ატვირთული (Employee Sales გვერდი). ჩვეულებრივ თვის ბოლოს იტვირთება — მანამდე ბარათზე 0 იქნება და ▼100% ცვლილება არ ნიშნავს ვარდნას." });
      if (noPrice) checks.push({ level: "error", text: `${noPrice} წამალს ფასი არ აქვს (0 ₾) — მათი გაყიდვები თანხაში არ ითვლება. Drugs გვერდზე ფასი შეავსე.` });
      if (noDrug) checks.push({ level: "error", text: `${noDrug} ხაზი წაშლილ წამალზეა მიბმული — თანხაში არ ითვლება.` });
      if (empty) checks.push({ level: "warn", text: `${empty} გაყიდვის ჩანაწერი ცარიელია (წამლები არ აქვს).` });
      const rows = [...byDrug.values()].map((r) => ({ ...r, boxes: r2(r.boxes), amount: r2(r.amount) })).sort((a, b) => b.amount - a.amount);
      return res.json({
        card,
        source: "Employee Sales გვერდზე ატვირთული აფთიაქების გაყიდვები ამ თვისთვის (ყველა თანამშრომელი).",
        formula: "თანხა = Σ (გაყიდული კოლოფი × წამლის ფასი Drugs გვერდიდან)",
        columns: [["drug", "წამალი"], ["boxes", "კოლოფი", "num"], ["price", "ფასი", "money"], ["amount", "თანხა", "money"]],
        rows,
        total: r2(rows.reduce((s, r) => s + r.amount, 0)),
        meta: `${sales.length} გაყიდვის ჩანაწერი · ${lines.length} ხაზი`,
        checks,
      });
    }

    // doctor budgets of the month (Prescription entry), per employee + doctor
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const itemFilter = { period: { $gte: new Date(monthStart.getTime() - 86400000), $lte: new Date(monthStart.getTime() + 86400000) } };
    if (scope) itemFilter.employee = { $in: scope };
    const items = await DoctorEntryItem.find(itemFilter)
      .select("employee doctor drug prescription sale budget coefficient totalBudget issuedBudget issuedBudgetSource bank")
      .populate("doctor", "firstName lastName uniqueNumber")
      .populate("employee", "firstName lastName").lean();
    const pairs = new Map();
    items.forEach((it) => {
      const k = `${it.employee?._id}|${it.doctor?._id}`;
      if (!pairs.has(k)) pairs.set(k, { employeeId: String(it.employee?._id), doctorId: String(it.doctor?._id), doctor: name(it.doctor), employee: name(it.employee), lines: 0, planned: 0, issued: 0, source: "", bank: "", noRate: 0, noSale: 0 });
      const p = pairs.get(k);
      p.lines += 1;
      p.planned += it.totalBudget || 0;
      p.issued = Math.max(p.issued, it.issuedBudget || 0);
      if (it.issuedBudgetSource) p.source = it.issuedBudgetSource;
      if (it.bank) p.bank = it.bank;
      if ((it.prescription || 0) > 0 && !(it.budget > 0)) p.noRate++;
      if ((it.prescription || 0) > 0 && !(it.coefficient > 0)) p.noSale++;
    });
    const all = [...pairs.values()].map((p) => ({ ...p, planned: r2(p.planned), issued: r2(p.issued), owed: r2(p.planned - p.issued) }));

    if (card === "planned") {
      const noSale = all.filter((p) => p.noSale > 0).length;
      const noRate = all.filter((p) => p.noRate > 0).length;
      const zero = all.filter((p) => p.planned === 0).length;
      if (noSale) checks.push({ level: "warn", text: `${noSale} ექიმთან კოეფიციენტი 0-ია — გაყიდვები (აფთიაქიდან ან რეცეპტებში) ჯერ არ არის შეყვანილი, ამიტომ დაგეგმილი ბიუჯეტი 0-ს აჩვენებს.` });
      if (noRate) checks.push({ level: "warn", text: `${noRate} ექიმთან ზოგ წამალს ბიუჯეტის განაკვეთი (ბონუსი კოლოფზე) არ აქვს — Bonuses გვერდზე შეამოწმე.` });
      if (zero) checks.push({ level: "info", text: `ბარათზე „${all.length} ექიმი“ ითვლის ყველა ექიმს, ვისზეც ამ თვეში რეცეპტი შეიყვანეს; მათგან ${zero}-ს დაგეგმილი 0-ია.` });
      const rows = all.sort((a, b) => b.planned - a.planned);
      return res.json({
        card,
        source: "„რეცეპტების შეყვანა“ გვერდი, ამ თვის ხაზები (ექიმი + თანამშრომელი).",
        formula: "დაგეგმილი = Σ (დანიშნული კოლოფი × ბიუჯეტი კოლოფზე × კოეფიციენტი);  კოეფიციენტი = გაყიდული ÷ დანიშნული",
        columns: [["doctor", "ექიმი"], ["employee", "წარმომადგენელი"], ["lines", "წამალი", "num"], ["planned", "დაგეგმილი", "money"]],
        rows,
        total: r2(rows.reduce((s, r) => s + r.planned, 0)),
        meta: `${rows.length} ექიმი · ${items.length} ხაზი`,
        checks,
      });
    }

    // budgets entered on the Budgets page this month, per employee + doctor
    const [bf, bt] = georgianMonth(y, m);
    const bFilter = { date: { $gte: bf, $lt: bt } };
    if (scope) bFilter.employee = { $in: scope };
    const budgets = await Budget.find(bFilter).select("employee doctor date paidAmount isActive")
      .populate("doctor", "firstName lastName").populate("employee", "firstName lastName").lean();
    const paidByPair = new Map();
    budgets.forEach((b) => {
      if (b.isActive === false) return;
      const k = `${b.employee?._id}|${b.doctor?._id}`;
      paidByPair.set(k, (paidByPair.get(k) || 0) + (b.paidAmount || 0));
    });

    if (card === "issued") {
      const rows = all.filter((p) => p.issued > 0 || paidByPair.has(`${p.employeeId}|${p.doctorId}`)).map((p) => {
        const fromBudgets = r2(paidByPair.get(`${p.employeeId}|${p.doctorId}`) || 0);
        return { doctor: p.doctor, employee: p.employee, issued: p.issued, fromBudgets, source: p.source === "manual" ? "ხელით" : p.source === "budget" ? "ბიუჯეტიდან" : "—", bank: p.bank || "—", diff: r2(p.issued - fromBudgets) };
      }).sort((a, b) => b.issued - a.issued);
      const mismatch = rows.filter((r) => Math.abs(r.diff) > 0.005).length;
      const manual = rows.filter((r) => r.source === "ხელით").length;
      const orphan = [...paidByPair.keys()].filter((k) => !pairs.has(k)).length;
      if (mismatch) checks.push({ level: "error", text: `${mismatch} ექიმთან „გაცემული“ არ ემთხვევა ბიუჯეტების გვერდზე შეყვანილ თანხას (სვეტი „სხვაობა“).` });
      if (manual) checks.push({ level: "info", text: `${manual} ექიმთან გაცემული თანხა ხელით არის ჩაწერილი რეცეპტებში და ბიუჯეტიდან არ ახლდება.` });
      if (orphan) checks.push({ level: "warn", text: `${orphan} ბიუჯეტი ისეთ ექიმზეა, ვისზეც ამ თვეში რეცეპტი არ არის შეყვანილი — „გაცემულში“ არ ჩანს, მხოლოდ „ბიუჯეტის გადახდებში“.` });
      return res.json({
        card,
        source: "„რეცეპტების შეყვანის“ ველი „გაცემული ბიუჯეტი“ — ავტომატურად ივსება ბიუჯეტების გვერდიდან (ან ხელით).",
        formula: "გაცემული = Σ ექიმების „გაცემული ბიუჯეტი“",
        columns: [["doctor", "ექიმი"], ["employee", "წარმომადგენელი"], ["issued", "გაცემული", "money"], ["fromBudgets", "ბიუჯეტებში", "money"], ["diff", "სხვაობა", "money"], ["source", "წყარო"], ["bank", "ბანკი"]],
        rows,
        total: r2(rows.reduce((s, r) => s + r.issued, 0)),
        meta: `${rows.length} ექიმი`,
        checks,
      });
    }

    if (card === "owed") {
      const rows = all.filter((p) => p.owed > 0.005).map((p) => ({ doctor: p.doctor, employee: p.employee, planned: p.planned, issued: p.issued, owed: p.owed })).sort((a, b) => b.owed - a.owed);
      const over = all.filter((p) => p.owed < -0.005);
      if (over.length) checks.push({ level: "info", text: `${over.length} ექიმს დაგეგმილზე მეტი აქვს გაცემული (ჯამში ${r2(-over.reduce((s, p) => s + p.owed, 0))} ₾) — ეს „გასასტუმრებელს“ არ ამცირებს.` });
      if (!rows.length && all.every((p) => p.planned === 0)) checks.push({ level: "warn", text: "ვალი 0-ია, რადგან დაგეგმილი ბიუჯეტი ჯერ 0-ია (გაყიდვები არ არის შეყვანილი) — ეს არ ნიშნავს, რომ ყველაფერი გადახდილია." });
      return res.json({
        card,
        source: "ექიმი + თანამშრომელი წყვილები, სადაც დაგეგმილი > გაცემული.",
        formula: "გასასტუმრებელი = Σ (დაგეგმილი − გაცემული), მხოლოდ დადებითი",
        columns: [["doctor", "ექიმი"], ["employee", "წარმომადგენელი"], ["planned", "დაგეგმილი", "money"], ["issued", "გაცემული", "money"], ["owed", "ვალი", "money"]],
        rows,
        total: r2(rows.reduce((s, r) => s + r.owed, 0)),
        meta: `${rows.length} ექიმი`,
        checks,
      });
    }

    // payments
    const rows = budgets.map((b) => ({
      date: new Date(b.date).toISOString().slice(0, 10),
      doctor: name(b.doctor),
      employee: name(b.employee),
      paid: r2(b.paidAmount),
      status: b.isActive === false ? "გამორთული" : "აქტიური",
    })).sort((a, b) => b.paid - a.paid);
    const inactive = budgets.filter((b) => b.isActive === false);
    if (inactive.length) checks.push({ level: "warn", text: `${inactive.length} ბიუჯეტი გამორთულია (${r2(inactive.reduce((s, b) => s + (b.paidAmount || 0), 0))} ₾) — ბარათი მათ აღარ ითვლის.` });
    if (!budgets.length) checks.push({ level: "info", text: "ამ თვეზე ბიუჯეტების გვერდზე ჯერ არაფერია შეყვანილი." });
    const active = rows.filter((r) => r.status === "აქტიური");
    return res.json({
      card,
      source: "ბიუჯეტების გვერდზე ამ თვეზე შეყვანილი ბიუჯეტები.",
      formula: "გადახდები = Σ „რა თანხას ვუხდით ექიმს“ (მხოლოდ აქტიური ბიუჯეტები)",
      columns: [["date", "თარიღი"], ["doctor", "ექიმი"], ["employee", "წარმომადგენელი"], ["paid", "გადახდილი", "money"], ["status", "სტატუსი"]],
      rows,
      total: r2(active.reduce((s, r) => s + r.paid, 0)),
      meta: `${active.length} აქტიური ჩანაწერი`,
      checks,
    });
  } catch (err) {
    console.error("getFinanceDetails failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
