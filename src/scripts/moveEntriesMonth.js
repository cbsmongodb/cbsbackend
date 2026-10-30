// Move one employee's prescription entries from one month to another
// (e.g. entered on October by mistake, should be September).
//   node src/scripts/moveEntriesMonth.js melano 2026-10 2026-09            (check only)
//   node src/scripts/moveEntriesMonth.js melano 2026-10 2026-09 --apply    (move)
// Lines that already exist in the target month (same doctor + drug) are NOT
// touched — they are listed so you can decide. Budget-filled "issued budget"
// is re-filled from the target month's budgets; typed ones stay.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import DoctorEntrySummary from "../models/DoctorEntrySummary.js";
import "../models/Doctor.js";
import "../models/Drug.js";
import { recalculateForPeriod } from "../routes/sales/doctorEntryItems.controller.js";
import { syncIssuedBudget } from "../utils/budgetSync.js";

const [who, fromM, toM] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const MRE = /^\d{4}-\d{2}$/;
if (!who || !MRE.test(fromM || "") || !MRE.test(toM || "")) {
  console.log("Usage: node src/scripts/moveEntriesMonth.js <name or email> <from YYYY-MM> <to YYYY-MM> [--apply]");
  process.exit(1);
}
const H = 3600 * 1000;
const win = (m) => { const [y, mo] = m.split("-").map(Number); return { $gte: new Date(Date.UTC(y, mo - 1, 1) - 12 * H), $lt: new Date(Date.UTC(y, mo, 1) - 12 * H) }; };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

await connectDB();
const rx = new RegExp(esc(who), "i");
const emps = await Employee.find({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] }).select("firstName lastName email").lean();
if (emps.length !== 1) {
  console.log(emps.length ? `⚠️  რამდენიმე თანამშრომელი მოიძებნა — დააზუსტე (მაგ. ელფოსტით):` : `❌ "${who}" ვერ ვიპოვე`);
  emps.forEach((e) => console.log(`   ${e.firstName} ${e.lastName}  ${e.email}`));
  await mongoose.disconnect(); process.exit(0);
}
const emp = emps[0];
const src = await DoctorEntryItem.find({ employee: emp._id, period: win(fromM) }).populate("doctor", "firstName lastName").populate("drug", "name").lean();
const dst = await DoctorEntryItem.find({ employee: emp._id, period: win(toM) }).select("doctor drug period").lean();
const taken = new Set(dst.map((i) => `${i.doctor}|${i.drug}`));
// keep the exact period value the target month already uses, else UTC 1st
const [ty, tm] = toM.split("-").map(Number);
const targetPeriod = dst[0]?.period || new Date(Date.UTC(ty, tm - 1, 1));

const move = src.filter((i) => !taken.has(`${i.doctor?._id}|${i.drug?._id}`));
const clash = src.filter((i) => taken.has(`${i.doctor?._id}|${i.drug?._id}`));
const nm = (p) => `${p?.firstName || ""} ${p?.lastName || ""}`.trim();
console.log(`\n${emp.firstName} ${emp.lastName} (${emp.email})`);
console.log(`${fromM}: ${src.length} ჩანაწერი (${new Set(src.map((i) => String(i.doctor?._id))).size} ექიმი, ${src.reduce((s, i) => s + (i.prescription || 0), 0)} რეცეპტი)`);
console.log(`${toM}-ში უკვე არის: ${dst.length} ჩანაწერი`);
console.log(`გადავა ${toM}-ზე: ${move.length}`);
if (clash.length) {
  console.log(`\n⚠️  ${clash.length} ჩანაწერი ${toM}-ში უკვე არსებობს (იგივე ექიმი + წამალი) — არ გადაგვაქვს:`);
  clash.forEach((i) => console.log(`   ${nm(i.doctor)} — ${i.drug?.name} (${i.prescription} რეცეპტი)`));
}

if (!APPLY) {
  console.log("\nCHECK ONLY — არაფერი შეცვლილა. გადასატანად დაამატე --apply");
} else if (move.length) {
  await DoctorEntryItem.updateMany(
    { _id: { $in: move.map((i) => i._id) }, issuedBudgetSource: "budget" },
    { $set: { issuedBudget: 0 }, $unset: { issuedBudgetSource: 1 } }
  );
  await DoctorEntryItem.updateMany({ _id: { $in: move.map((i) => i._id) } }, { $set: { period: targetPeriod } });
  // drug totals of both months rebuilt from what is there now
  for (const m of [fromM, toM]) {
    const rows = await DoctorEntryItem.find({ employee: emp._id, period: win(m) }).select("drug prescription period").lean();
    await DoctorEntrySummary.deleteMany({ employee: emp._id, period: win(m) });
    const byDrug = new Map();
    rows.forEach((r) => byDrug.set(String(r.drug), (byDrug.get(String(r.drug)) || 0) + (r.prescription || 0)));
    const p = rows[0]?.period;
    if (p && byDrug.size) await DoctorEntrySummary.insertMany([...byDrug].map(([drug, prescription]) => ({ employee: emp._id, drug, period: p, prescription })));
  }
  for (const d of new Set(move.map((i) => String(i.doctor?._id)))) {
    try { await syncIssuedBudget(emp._id, d, new Date(Date.UTC(ty, tm - 1, 15))); } catch (e) { console.error("sync:", e.message); }
  }
  const fromP = src[0]?.period;
  if (fromP) await recalculateForPeriod(emp._id, fromP);
  await recalculateForPeriod(emp._id, targetPeriod);
  console.log(`\n✅ ${move.length} ჩანაწერი გადავიდა ${fromM} → ${toM}`);
}
await mongoose.disconnect();
