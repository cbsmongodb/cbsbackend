// Bonus per box, for one doctor + drug + month. Order (first one found wins):
//   1. DoctorDrugBonus   - this doctor, this drug, this month   (Bonuses page, "doctors")
//   2. DrugBonus         - this drug, this month                 (Bonuses page)
//   3. Drug.bonus        - the drug's old general bonus (when > 0)
//   4. DEFAULT_BONUS (1) - from DEFAULT_FROM on, so nothing is multiplied by 0
// Before DEFAULT_FROM there is no default: old months keep what they had.
//
// The bonus is copied onto every prescription line (DoctorEntryItem.budget);
// payable amounts, analytics and budgets all read it from there. So after a
// bonus changes, restampBonuses() writes the new value onto that month's lines
// and recalculates them.
import DrugBonus from "../models/DrugBonus.js";
import DoctorDrugBonus from "../models/DoctorDrugBonus.js";
import Drug from "../models/Drug.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import { recalculateForPeriod } from "../routes/sales/doctorEntryItems.controller.js";

export const DEFAULT_BONUS = 1;
export const DEFAULT_FROM = { y: 2026, m: 9 }; // October 2026 (m = 0..11)
const H = 3600 * 1000;

// "2026-10" | Date | "2026-10-01" -> { y, m }  (a Date is read as a Georgian month)
export function parseMonth(x) {
  if (typeof x === "string" && /^\d{4}-\d{2}$/.test(x)) {
    const [y, m] = x.split("-").map(Number);
    return { y, m: m - 1 };
  }
  const d = new Date(new Date(x).getTime() + 12 * H); // UTC or Tbilisi midnight -> same day
  if (isNaN(d.getTime())) return null;
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}
export const monthStart = ({ y, m }) => new Date(Date.UTC(y, m, 1)); // how bonuses are stored
// prescription lines store "the 1st" at UTC or Tbilisi midnight -> a window that catches both
export const monthWindow = ({ y, m }) => ({ $gte: new Date(Date.UTC(y, m, 1) - 12 * H), $lt: new Date(Date.UTC(y, m + 1, 1) - 12 * H) });
export const monthLabel = ({ y, m }) => `${y}-${String(m + 1).padStart(2, "0")}`;
export const hasDefault = ({ y, m }) => y * 12 + m >= DEFAULT_FROM.y * 12 + DEFAULT_FROM.m;

// drug-level bonus of a month: Map(drugId -> { value, source })
//   source: "month" (set for this month) | "drug" (old general bonus) | "default"
export async function drugBonuses(month, drugIds) {
  const ids = [...new Set(drugIds.map(String))];
  const out = new Map();
  if (!ids.length) return out;
  const [monthly, drugs] = await Promise.all([
    DrugBonus.find({ drug: { $in: ids }, period: monthWindow(month) }).select("drug value").lean(),
    Drug.find({ _id: { $in: ids } }).select("bonus").lean(),
  ]);
  monthly.forEach((b) => out.set(String(b.drug), { value: b.value, source: "month" }));
  drugs.forEach((d) => {
    const k = String(d._id);
    if (out.has(k)) return;
    if (d.bonus > 0) out.set(k, { value: d.bonus, source: "drug" });
    else if (hasDefault(month)) out.set(k, { value: DEFAULT_BONUS, source: "default" });
  });
  return out;
}

// doctor-specific bonuses of a month: Map("doctorId|drugId" -> value)
export async function doctorBonuses(month, filter = {}) {
  const rows = await DoctorDrugBonus.find({ ...filter, period: monthWindow(month) }).select("doctor drug value").lean();
  return new Map(rows.map((r) => [`${r.doctor}|${r.drug}`, r.value]));
}

// final bonus for doctor + drug pairs: Map("doctorId|drugId" -> value). Pairs with no bonus at all are left out.
export async function resolveBonuses(month, pairs) {
  const out = new Map();
  if (!pairs.length) return out;
  const [byDrug, byDoctor] = await Promise.all([
    drugBonuses(month, pairs.map((p) => p.drug)),
    doctorBonuses(month, { drug: { $in: [...new Set(pairs.map((p) => String(p.drug)))] }, doctor: { $in: [...new Set(pairs.map((p) => String(p.doctor)))] } }),
  ]);
  for (const p of pairs) {
    const k = `${p.doctor}|${p.drug}`;
    if (byDoctor.has(k)) out.set(k, byDoctor.get(k));
    else if (byDrug.has(String(p.drug))) out.set(k, byDrug.get(String(p.drug)).value);
  }
  return out;
}

// write the current bonus onto a month's prescription lines (optionally only one
// drug / one doctor) and recalculate the employees whose numbers changed.
// dryRun -> only counts. Returns { lines, changed, employees }.
export async function restampBonuses(month, { drug, doctor, dryRun = false } = {}) {
  const filter = { period: monthWindow(month) };
  if (drug) filter.drug = drug;
  if (doctor) filter.doctor = doctor;
  const items = await DoctorEntryItem.find(filter).select("employee doctor drug period budget").lean();
  const resolved = await resolveBonuses(month, items.map((i) => ({ doctor: i.doctor, drug: i.drug })));

  const changes = [];
  for (const it of items) {
    const v = resolved.get(`${it.doctor}|${it.drug}`);
    if (v === undefined || v === (it.budget || 0)) continue;
    changes.push({ it, v });
  }
  const employees = new Map(); // "employee|period" -> { employee, period }
  changes.forEach(({ it }) => employees.set(`${it.employee}|${+new Date(it.period)}`, { employee: it.employee, period: it.period }));

  if (!dryRun && changes.length) {
    await DoctorEntryItem.bulkWrite(
      changes.map(({ it, v }) => ({ updateOne: { filter: { _id: it._id }, update: { $set: { budget: v } } } }))
    );
    for (const { employee, period } of employees.values()) await recalculateForPeriod(employee, new Date(period));
  }
  return { lines: items.length, changed: changes.length, employees: employees.size, changes };
}
