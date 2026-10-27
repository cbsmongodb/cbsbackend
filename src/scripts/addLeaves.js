// Adds approved leave days (paid / unpaid / sick) for employees, by email.
//   node src/scripts/addLeaves.js src/scripts/leaves-2026-10.json            (check only)
//   node src/scripts/addLeaves.js src/scripts/leaves-2026-10.json --apply    (write)
// Weekends and rest days are skipped. A day the employee already has as
// approved / pending leave is skipped too, so running it twice is safe.
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import LeaveEntry from "../models/LeaveEntry.js";
import RestDay from "../models/RestDay.js";
import Employee from "../models/Employee.js";

const file = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!file || !fs.existsSync(file)) { console.error("Usage: node src/scripts/addLeaves.js <file.json> [--apply]"); process.exit(1); }
const { createdByEmail, leaves } = JSON.parse(fs.readFileSync(file, "utf8"));

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const toDay = (s) => new Date(`${s}T00:00:00.000Z`);
const TYPE_KA = { paid: "ანაზღაურებადი", unpaid: "არაანაზღაურებადი", sick: "ბიულეტენი" };

function daysOf(entry) {
  if (entry.days?.length) return entry.days.map((d) => dayKey(d.date));
  const out = [];
  for (let d = new Date(dayKey(entry.startDate)); d <= new Date(dayKey(entry.endDate)); d = new Date(d.getTime() + 86400000)) {
    const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(dayKey(d));
  }
  return out;
}

await connectDB();
console.log(APPLY ? "\nAPPLY — writing\n" : "\nCHECK ONLY — nothing is written\n");
const author = await Employee.findOne({ email: createdByEmail.toLowerCase() }).select("_id").lean();
if (!author) { console.error(`❌ ${createdByEmail} not found`); process.exit(1); }
const restKeys = new Set((await RestDay.find({}).select("date").lean()).map((r) => dayKey(new Date(r.date.getTime() + 12 * 3600e3))));

let added = 0, problems = 0;
for (const l of leaves) {
  const emp = await Employee.findOne({ email: l.email.toLowerCase() }).select("firstName lastName").lean();
  if (!emp) { console.log(`❌ ${l.name}: ${l.email} ვერ ვიპოვე`); problems++; continue; }
  const wanted = [];
  for (let d = toDay(l.from); d <= toDay(l.to); d = new Date(d.getTime() + 86400000)) {
    const k = dayKey(d), wd = d.getUTCDay();
    if (wd === 0 || wd === 6 || restKeys.has(k)) continue;
    wanted.push(k);
  }
  const existing = await LeaveEntry.find({ employee: emp._id, startDate: { $lte: toDay(l.to) }, endDate: { $gte: toDay(l.from) }, status: { $in: ["approved", "pending", null] } }).lean();
  const taken = new Set(existing.flatMap(daysOf));
  const days = wanted.filter((k) => !taken.has(k));
  const label = `${emp.firstName} ${emp.lastName} — ${TYPE_KA[l.type]}`;
  if (!days.length) { console.log(`ℹ️  ${label}: უკვე შეყვანილია (${wanted.join(", ")})`); continue; }
  console.log(`✅ ${label}: ${days.map((k) => `${k.slice(8)}.${k.slice(5, 7)}`).join(", ")} (${days.length} დღე)${days.length < wanted.length ? "  [ნაწილი უკვე იყო]" : ""}`);
  if (APPLY) {
    await LeaveEntry.create({
      employee: emp._id, type: l.type, startDate: toDay(days[0]), endDate: toDay(days[days.length - 1]),
      daysCount: days.length, days: days.map((k) => ({ date: toDay(k), type: l.type })),
      note: l.note || "", status: "approved", decidedBy: author._id, decidedAt: new Date(), createdBy: author._id,
    });
  }
  added++;
}
console.log(`\n${APPLY ? "ჩაიწერა" : "ჩაიწერება"}: ${added}${problems ? `, პრობლემა: ${problems}` : ""}${APPLY ? "" : "\nყველაფერი სწორია? გაუშვი --apply-ით"}`);
await mongoose.disconnect();
