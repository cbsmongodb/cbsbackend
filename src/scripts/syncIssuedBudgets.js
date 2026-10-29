// One-time: fill the "issued budget" on prescription entry from budgets that
// already exist. Only EMPTY ones are filled — numbers typed by hand stay.
//   node src/scripts/syncIssuedBudgets.js 2026-10            (check only)
//   node src/scripts/syncIssuedBudgets.js 2026-10 --apply    (write)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Budget from "../models/Budget.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import { syncIssuedBudget } from "../utils/budgetSync.js";

const month = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a));
const APPLY = process.argv.includes("--apply");
if (!month) { console.log("Usage: node src/scripts/syncIssuedBudgets.js YYYY-MM [--apply]"); process.exit(1); }
const [y, m] = month.split("-").map(Number);
const H = 3600 * 1000;

await connectDB();
const budgets = await Budget.find({
  isActive: { $ne: false },
  date: { $gte: new Date(Date.UTC(y, m - 1, 1) - 4 * H), $lt: new Date(Date.UTC(y, m, 1) - 4 * H) },
}).select("employee doctor date paidAmount").lean();
const pairs = new Map();
budgets.forEach((b) => pairs.set(`${b.employee}|${b.doctor}`, b));
let empty = 0, manual = 0, none = 0;
for (const b of pairs.values()) {
  const items = await DoctorEntryItem.find({
    employee: b.employee, doctor: b.doctor,
    period: { $gte: new Date(Date.UTC(y, m - 1, 1) - 12 * H), $lt: new Date(Date.UTC(y, m, 1) - 12 * H) },
  }).select("issuedBudget issuedBudgetSource").lean();
  if (!items.length) { none++; continue; }
  if (items.some((i) => i.issuedBudgetSource === "budget" || (!i.issuedBudgetSource && !i.issuedBudget))) {
    empty++;
    if (APPLY) await syncIssuedBudget(b.employee, b.doctor, b.date);
  } else manual++;
}
console.log(`\n${month}: ${budgets.length} ბიუჯეტი, ${pairs.size} თანამშრომელი+ექიმი`);
console.log(`  შეივსება ბიუჯეტიდან: ${empty}`);
console.log(`  ხელით შევსებული — არ ვეხებით: ${manual}`);
console.log(`  რეცეპტი ჯერ არ არის შეყვანილი: ${none} (შეყვანისას თავისით შეივსება)`);
console.log(APPLY ? "\n✅ შევსებულია" : "\nCHECK ONLY — ჩასაწერად დაამატე --apply");
await mongoose.disconnect();
