// Budgets -> "issued budget" on prescription entry.
// When a budget is added / changed / deleted on the Budgets page, the sum of
// the paid amounts for that employee + doctor + month is written into the
// doctor's "issued budget" on Prescription entry.
// Rows a person typed in by hand (issuedBudgetSource "manual", or an old row
// that already had a number) are never overwritten.
import mongoose from "mongoose";
import Budget from "../models/Budget.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import { recalculateForPeriod } from "../routes/sales/doctorEntryItems.controller.js";

const H = 3600 * 1000;
const r2 = (n) => Math.round((n || 0) * 100) / 100;

// Georgian month (UTC+4) a date falls in -> { y, m } (m = 0..11)
export function monthOfDate(date) {
  const d = new Date(new Date(date).getTime() + 4 * H);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
}

// budgets of one Georgian month: [1st 00:00 Tbilisi, next 1st 00:00 Tbilisi)
function budgetWindow({ y, m }) {
  return { $gte: new Date(Date.UTC(y, m, 1) - 4 * H), $lt: new Date(Date.UTC(y, m + 1, 1) - 4 * H) };
}
// entry periods are "the 1st of the month" saved at UTC or Tbilisi midnight
function periodWindow({ y, m }) {
  return { $gte: new Date(Date.UTC(y, m, 1) - 12 * H), $lt: new Date(Date.UTC(y, m + 1, 1) - 12 * H) };
}

// { doctorId: paid sum } for one employee and month (active budgets only)
export async function budgetSumsByDoctor(employee, ym) {
  const rows = await Budget.aggregate([
    { $match: { employee: new mongoose.Types.ObjectId(String(employee)), isActive: { $ne: false }, date: budgetWindow(ym) } },
    { $group: { _id: "$doctor", sum: { $sum: "$paidAmount" } } },
  ]);
  const out = {};
  rows.forEach((r) => { out[String(r._id)] = r2(r.sum); });
  return out;
}

// re-fill the issued budget for one employee + doctor + month
export async function syncIssuedBudget(employee, doctor, date) {
  if (!employee || !doctor || !date) return;
  const ym = monthOfDate(date);
  const sums = await budgetSumsByDoctor(employee, ym);
  const sum = sums[String(doctor)] || 0;
  const items = await DoctorEntryItem.find({ employee, doctor, period: periodWindow(ym) })
    .select("issuedBudget issuedBudgetSource period").lean();
  const auto = items.filter((i) => i.issuedBudgetSource === "budget" || (!i.issuedBudgetSource && !i.issuedBudget));
  if (!auto.length) return;
  await DoctorEntryItem.updateMany(
    { _id: { $in: auto.map((i) => i._id) } },
    { $set: { issuedBudget: sum, issuedBudgetSource: "budget" } }
  );
  const periods = [...new Set(auto.map((i) => +new Date(i.period)))];
  for (const p of periods) await recalculateForPeriod(employee, new Date(p));
}

// safe wrapper for the budget handlers: a failed sync never breaks the budget save
export async function syncIssuedBudgetSafe(...keys) {
  for (const k of keys) {
    if (!k) continue;
    try { await syncIssuedBudget(k.employee, k.doctor, k.date); }
    catch (err) { console.error("syncIssuedBudget failed:", err); }
  }
}
