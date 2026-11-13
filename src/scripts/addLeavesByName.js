// Adds approved leave days, people found by SURNAME (Latin, as in the system).
//   node src/scripts/addLeavesByName.js src/scripts/leaves-batch1.json          (check only)
//   node src/scripts/addLeavesByName.js src/scripts/leaves-batch1.json --apply  (write)
// Entry: { "ka": "ნინო ბასილიძე", "last": "Basilidze", "first": "Nino",
//          "type": "paid|unpaid|sick", "from": "2026-11-06", "to": "2026-11-06",
//          "weekends": true (optional: count Sat/Sun too) }
// Weekends (unless "weekends") and rest days are skipped. Days the person
// already has as leave are skipped, so running it twice is safe.
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import LeaveEntry from "../models/LeaveEntry.js";
import RestDay from "../models/RestDay.js";
import Employee from "../models/Employee.js";

const file = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!file || !fs.existsSync(file)) {
  console.error("Usage: node src/scripts/addLeavesByName.js <file.json> [--apply]");
  process.exit(1);
}
const { createdByEmail, leaves } = JSON.parse(fs.readFileSync(file, "utf8"));
const H12 = 12 * 3600e3;
const dayKey = (d) => new Date(+new Date(d) + H12).toISOString().slice(0, 10);
const toDay = (s) => new Date(`${s}T00:00:00.000Z`);
const TYPE_KA = { paid: "ანაზღაურებადი", unpaid: "არაანაზღაურებადი", sick: "ბიულეტენი" };
const short = (k) => `${k.slice(8)}.${k.slice(5, 7)}`;

function daysOf(entry) {
  if (entry.days?.length) return entry.days.map((d) => dayKey(d.date));
  const out = [];
  const end = new Date(dayKey(entry.endDate));
  for (let d = new Date(dayKey(entry.startDate)); d <= end; d = new Date(+d + 86400000)) {
    out.push(dayKey(d));
  }
  return out;
}

await connectDB();
console.log(APPLY ? "\nAPPLY - writing\n" : "\nCHECK ONLY - nothing is written\n");
const author = await Employee.findOne({ email: createdByEmail.toLowerCase() }).select("_id").lean();
if (!author) {
  console.error(`author ${createdByEmail} not found`);
  process.exit(1);
}
const restRows = await RestDay.find({}).select("date").lean();
const restKeys = new Set(restRows.map((r) => dayKey(r.date)));

let added = 0;
let problems = 0;
for (const l of leaves) {
  // optional "email" in the entry finds the person by e-mail instead of surname
  let found = l.email
    ? await Employee.find({ email: String(l.email).toLowerCase(), isActive: { $ne: false } })
        .select("firstName lastName email").lean()
    : await Employee.find({ lastName: new RegExp(l.last, "i"), isActive: { $ne: false } })
        .select("firstName lastName email").lean();
  if (found.length > 1 && l.first) {
    const f = new RegExp(`^(${l.first})`, "i");
    const narrowed = found.filter((e) => f.test(e.firstName || ""));
    if (narrowed.length) found = narrowed;
  }
  if (found.length !== 1) {
    problems++;
    console.log(`❌ ${l.ka}: ${found.length ? "რამდენიმე მოიძებნა" : "ვერ მოიძებნა"}`);
    found.forEach((e) => console.log(`     ${e.firstName} ${e.lastName}  ${e.email}`));
    continue;
  }
  const emp = found[0];
  const wanted = [];
  for (let d = toDay(l.from); d <= toDay(l.to); d = new Date(+d + 86400000)) {
    const k = dayKey(d);
    const wd = d.getUTCDay();
    if (!l.weekends && (wd === 0 || wd === 6)) continue;
    if (!l.weekends && restKeys.has(k)) continue;
    wanted.push(k);
  }
  const existing = await LeaveEntry.find({
    employee: emp._id,
    startDate: { $lte: new Date(+toDay(l.to) + H12) },
    endDate: { $gte: new Date(+toDay(l.from) - H12) },
    status: { $in: ["approved", "pending", null] },
  }).lean();
  const taken = new Set(existing.flatMap(daysOf));
  const days = wanted.filter((k) => !taken.has(k));
  const who = `${l.ka} = ${emp.firstName} ${emp.lastName} <${emp.email}>`;
  const label = `${who} - ${TYPE_KA[l.type]}`;
  if (!days.length) {
    console.log(`ℹ️  ${label}: უკვე შეყვანილია`);
    continue;
  }
  const part = days.length < wanted.length ? "  [ნაწილი უკვე იყო]" : "";
  const list = days.length > 6
    ? `${short(days[0])} ... ${short(days[days.length - 1])}`
    : days.map(short).join(", ");
  console.log(`✅ ${label}: ${list} (${days.length} დღე)${part}`);
  if (APPLY) {
    await LeaveEntry.create({
      employee: emp._id,
      type: l.type,
      startDate: toDay(days[0]),
      endDate: toDay(days[days.length - 1]),
      daysCount: days.length,
      days: days.map((k) => ({ date: toDay(k), type: l.type })),
      note: l.note || "",
      status: "approved",
      decidedBy: author._id,
      decidedAt: new Date(),
      createdBy: author._id,
    });
  }
  added++;
}
const verb = APPLY ? "ჩაიწერა" : "ჩაიწერება";
console.log(`\n${verb}: ${added}${problems ? `, პრობლემა: ${problems}` : ""}`);
if (!APPLY) console.log("ყველაფერი სწორია? გაუშვი --apply-ით");
await mongoose.disconnect();
