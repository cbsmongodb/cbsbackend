import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import EmployeeSale from "../../models/EmployeeSale.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import CoefficientOverride from "../../models/CoefficientOverride.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";

// GET /api/reports/prescriptions?from=YYYY-MM&to=YYYY-MM&employee=
// Every Data Entry line with a prescription (> 0): who, which doctor, hospital,
// drug, how many boxes were prescribed and how many were sold.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// periods are "the 1st of the month"; depending on where they were saved that is
// midnight UTC or midnight Georgia time (20:00 UTC the day before). A window
// shifted by 12h catches both without touching the neighbouring month.
const HALF_DAY = 12 * 3600 * 1000;
function monthStart(m) {
  return new Date(new Date(`${m}-01T00:00:00Z`).getTime() - HALF_DAY);
}
function nextMonthStart(m) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 1) - HALF_DAY);
}
function monthOf(date) {
  const d = new Date(new Date(date).getTime() + HALF_DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const fullName = (p) => (p ? `${p.firstName || ""} ${p.lastName || ""}`.trim() || p.name || "" : "");

export async function getPrescriptionsReport(req, res) {
  try {
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const from = MONTH_RE.test(req.query.from || "") ? req.query.from : current;
    let to = MONTH_RE.test(req.query.to || "") ? req.query.to : from;
    if (to < from) to = from;

    const filter = {
      period: { $gte: monthStart(from), $lt: nextMonthStart(to) },
      prescription: { $gt: 0 },
    };
    if (req.query.employee) filter.employee = req.query.employee;

    // ownOnly: a representative sees only the prescriptions they entered,
    // even if they are also set as head of some group
    const ownOnly = (req.employee?.role?.name || "").toLowerCase().trim() === "representative";
    if (ownOnly) filter.employee = req.employee._id;

    const scopeIds = ownOnly ? null : await getScopeEmployeeIds(req.employee);
    if (scopeIds) {
      const allowed = new Set(scopeIds.map(String));
      if (filter.employee) {
        if (!allowed.has(String(filter.employee))) filter.employee = { $in: [] };
      } else {
        filter.employee = { $in: scopeIds };
      }
    }

    const items = await DoctorEntryItem.find(filter)
      .populate("employee", "firstName lastName")
      .populate("doctor", "firstName lastName uniqueNumber")
      .populate("drug", "name")
      .populate("hospital", "name")
      .sort({ period: -1 })
      .limit(20000)
      .lean();

    // sold per line, the same way the budgets count it:
    //   coefficient = rep's pharmacy sales of the drug in the month ÷ all their prescriptions of it
    //   (an admin coefficient override wins), sold = prescription × coefficient
    const idOf = (x) => String(x?._id || x || "");
    const keyOf = (i) => `${idOf(i.employee)}|${monthOf(i.period)}|${idOf(i.drug)}`;
    const rxTotal = new Map(), typedSale = new Map();
    items.forEach((i) => {
      const k = keyOf(i);
      rxTotal.set(k, (rxTotal.get(k) || 0) + (i.prescription || 0));
      typedSale.set(k, (typedSale.get(k) || 0) + (i.sale || 0));
    });
    const emps = [...new Set(items.map((i) => idOf(i.employee)).filter(Boolean))];
    const months = [...new Set(items.map((i) => monthOf(i.period)))];
    const pharmacy = new Map();
    for (const m of months) {
      const sales = await EmployeeSale.find({ employee: { $in: emps }, date: { $gte: monthStart(m), $lt: nextMonthStart(m) } }).select("_id employee").lean();
      if (!sales.length) continue;
      const empOf = new Map(sales.map((s) => [String(s._id), String(s.employee)]));
      const lines = await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((s) => s._id) } })
        .select("medicineTargatableId drug totalNoOfBoxes").lean();
      lines.forEach((l) => {
        const k = `${empOf.get(String(l.medicineTargatableId))}|${m}|${l.drug}`;
        pharmacy.set(k, (pharmacy.get(k) || 0) + (l.totalNoOfBoxes || 0));
      });
    }
    const overrides = new Map(
      (await CoefficientOverride.find({ employee: { $in: emps }, period: { $gte: monthStart(from), $lt: nextMonthStart(to) } }).select("employee drug period coefficient").lean())
        .map((o) => [`${o.employee}|${monthOf(o.period)}|${o.drug}`, o.coefficient])
    );
    const coefOf = (k) => {
      if (overrides.has(k)) return overrides.get(k);
      const rx = rxTotal.get(k) || 0;
      if (!rx) return 0;
      return (pharmacy.has(k) ? pharmacy.get(k) : typedSale.get(k) || 0) / rx;
    };
    const r2 = (n) => Math.round(n * 100) / 100;

    res.json(
      items.map((i) => ({
        _id: i._id,
        month: monthOf(i.period),
        employeeName: fullName(i.employee),
        doctorName: fullName(i.doctor),
        doctorNumber: i.doctor?.uniqueNumber || "",
        hospitalName: i.hospital?.name || "",
        drugName: i.drug?.name || "",
        prescription: i.prescription || 0,
        sale: i.sale || 0,
        coefficient: r2(coefOf(keyOf(i))),
        sold: r2((i.prescription || 0) * coefOf(keyOf(i))),
      }))
    );
  } catch (err) {
    console.error("getPrescriptionsReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
