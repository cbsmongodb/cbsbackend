// Move prescription entries of one employee (optionally one doctor) from one
// month to another. Lines that already exist in the target month (same
// doctor + drug) are left where they are and reported back.
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import DoctorEntrySummary from "../models/DoctorEntrySummary.js";
import { recalculateForPeriod } from "../routes/sales/doctorEntryItems.controller.js";
import { syncIssuedBudget } from "./budgetSync.js";

const H = 3600 * 1000;
export const monthWindow = (y, m) => ({ $gte: new Date(Date.UTC(y, m - 1, 1) - 12 * H), $lt: new Date(Date.UTC(y, m, 1) - 12 * H) });

// from / to: { y, m } with m = 1..12
export async function moveEntries({ employee, doctor = null, from, to }) {
  const q = (w) => ({ employee, period: w, ...(doctor ? { doctor } : {}) });
  const src = await DoctorEntryItem.find(q(monthWindow(from.y, from.m))).select("doctor drug period prescription").lean();
  const dst = await DoctorEntryItem.find({ employee, period: monthWindow(to.y, to.m) }).select("doctor drug period").lean();
  const taken = new Set(dst.map((i) => `${i.doctor}|${i.drug}`));
  const move = src.filter((i) => !taken.has(`${i.doctor}|${i.drug}`));
  const clashes = src.filter((i) => taken.has(`${i.doctor}|${i.drug}`));
  if (!move.length) return { moved: 0, clashes };

  const targetPeriod = dst[0]?.period || new Date(Date.UTC(to.y, to.m - 1, 1));
  const ids = move.map((i) => i._id);
  await DoctorEntryItem.updateMany({ _id: { $in: ids }, issuedBudgetSource: "budget" }, { $set: { issuedBudget: 0 }, $unset: { issuedBudgetSource: 1 } });
  await DoctorEntryItem.updateMany({ _id: { $in: ids } }, { $set: { period: targetPeriod } });

  // drug totals of both months rebuilt from what is there now
  for (const mm of [from, to]) {
    const w = monthWindow(mm.y, mm.m);
    const rows = await DoctorEntryItem.find({ employee, period: w }).select("drug prescription period").lean();
    await DoctorEntrySummary.deleteMany({ employee, period: w });
    const byDrug = new Map();
    rows.forEach((r) => byDrug.set(String(r.drug), (byDrug.get(String(r.drug)) || 0) + (r.prescription || 0)));
    if (rows[0] && byDrug.size) {
      await DoctorEntrySummary.insertMany([...byDrug].map(([drug, prescription]) => ({ employee, drug, period: rows[0].period, prescription })));
    }
  }
  for (const d of new Set(move.map((i) => String(i.doctor)))) {
    try { await syncIssuedBudget(employee, d, new Date(Date.UTC(to.y, to.m - 1, 15))); } catch (e) { console.error("moveEntries sync:", e.message); }
  }
  if (src[0]) await recalculateForPeriod(employee, src[0].period);
  await recalculateForPeriod(employee, targetPeriod);
  return { moved: move.length, clashes };
}
