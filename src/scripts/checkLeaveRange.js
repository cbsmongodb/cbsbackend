// Checks that a person has a leave entered for EVERY working day of a range,
// and that no rest day (holiday) was counted as leave.
//   node src/scripts/checkLeaveRange.js Berianidze 2026-08-06 2026-08-31 paid           (check only)
//   node src/scripts/checkLeaveRange.js Berianidze 2026-08-06 2026-08-31 paid --apply   (fix)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import LeaveEntry from "../models/LeaveEntry.js";
import RestDay from "../models/RestDay.js";
import Employee from "../models/Employee.js";

const [last, fromS, toS, type = "paid"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!last || !fromS || !toS) {
  console.error("Usage: node src/scripts/checkLeaveRange.js <LastName> <from> <to> [paid|unpaid|sick] [--apply]");
  process.exit(1);
}
const H12 = 12 * 3600e3;
const dayKey = (d) => new Date(+new Date(d) + H12).toISOString().slice(0, 10);
const toDay = (s) => new Date(`${s}T00:00:00.000Z`);
const short = (k) => `${k.slice(8)}.${k.slice(5, 7)}`;
const TYPE_KA = { paid: "ანაზღაურებადი", unpaid: "არაანაზღაურებადი", sick: "ბიულეტენი" };

function daysOf(e) {
  if (e.days?.length) return e.days.map((d) => ({ k: dayKey(d.date), t: d.type }));
  const out = [];
  for (let d = new Date(dayKey(e.startDate)); d <= new Date(dayKey(e.endDate)); d = new Date(+d + 86400000)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push({ k: dayKey(d), t: e.type });
  }
  return out;
}

await connectDB();
console.log(APPLY ? "\nAPPLY - writing\n" : "\nCHECK ONLY - nothing is written\n");
const emps = await Employee.find({ lastName: new RegExp(`^\\s*${last}\\s*$`, "i"), isActive: { $ne: false } }).select("firstName lastName email").lean();
if (emps.length !== 1) {
  console.log(emps.length ? "❌ რამდენიმე მოიძებნა:" : `❌ ${last} ვერ მოიძებნა`);
  emps.forEach((e) => console.log(`   ${e.firstName} ${e.lastName} ${e.email}`));
  await mongoose.disconnect(); process.exit(1);
}
const emp = emps[0];
console.log(`${emp.firstName} ${emp.lastName} <${emp.email}> — ${TYPE_KA[type]} ${short(fromS)}–${short(toS)}`);

const rest = await RestDay.find({ date: { $gte: new Date(+toDay(fromS) - H12), $lte: new Date(+toDay(toS) + H12) } }).lean();
const restKeys = new Map(rest.map((r) => [dayKey(r.date), r.label || ""]));
console.log(`დასვენების დღეები ამ პერიოდში: ${rest.length ? [...restKeys].map(([k, l]) => `${short(k)}${l ? ` (${l})` : ""}`).join(", ") : "არცერთი არ არის შეყვანილი სისტემაში ⚠️"}`);

const want = [];
for (let d = toDay(fromS); d <= toDay(toS); d = new Date(+d + 86400000)) {
  const k = dayKey(d), wd = d.getUTCDay();
  if (wd !== 0 && wd !== 6 && !restKeys.has(k)) want.push(k);
}

const entries = await LeaveEntry.find({
  employee: emp._id,
  startDate: { $lte: new Date(+toDay(toS) + H12) },
  endDate: { $gte: new Date(+toDay(fromS) - H12) },
  status: { $in: ["approved", null] },
});
const have = new Map();
entries.forEach((e) => daysOf(e).forEach(({ k, t }) => { if (k >= fromS && k <= toS) have.set(k, t); }));

const missing = want.filter((k) => !have.has(k));
const wrongType = want.filter((k) => have.has(k) && have.get(k) !== type);
const extra = [...have.keys()].filter((k) => !want.includes(k)).sort();
const ok = want.length - missing.length - wrongType.length;

console.log(`\nსამუშაო დღე პერიოდში: ${want.length}  |  შეყვანილია სწორად: ${ok}`);
console.log(missing.length ? `❌ აკლია (${missing.length}): ${missing.map(short).join(", ")}` : "✅ არცერთი დღე არ აკლია");
if (wrongType.length) console.log(`⚠️  სხვა ტიპით წერია (${wrongType.length}): ${wrongType.map((k) => `${short(k)}=${TYPE_KA[have.get(k)]}`).join(", ")}  — ამას სკრიპტი არ ცვლის`);
console.log(extra.length ? `❌ დასვენების/შაბათ-კვირის დღე ჩათვლილია შვებულებად (${extra.length}): ${extra.map((k) => `${short(k)}${restKeys.has(k) ? " დასვენება" : ""}`).join(", ")}` : "✅ დასვენების დღე შვებულებად არ არის ჩათვლილი");

if (APPLY && (missing.length || extra.length)) {
  const extraSet = new Set(extra);
  for (const e of entries) {
    const ds = daysOf(e);
    if (!ds.some(({ k }) => extraSet.has(k))) continue;
    const keep = ds.filter(({ k }) => !extraSet.has(k));
    if (!keep.length) { await LeaveEntry.deleteOne({ _id: e._id }); continue; }
    const ks = keep.map((x) => x.k).sort();
    e.days = keep.map(({ k, t }) => ({ date: toDay(k), type: t }));
    e.daysCount = keep.length;
    e.startDate = toDay(ks[0]);
    e.endDate = toDay(ks[ks.length - 1]);
    await e.save();
  }
  if (missing.length) {
    const author = await Employee.findOne({ email: "lbogveradze12@gmail.com" }).select("_id").lean();
    await LeaveEntry.create({
      employee: emp._id, type, startDate: toDay(missing[0]), endDate: toDay(missing[missing.length - 1]),
      daysCount: missing.length, days: missing.map((k) => ({ date: toDay(k), type })),
      status: "approved", decidedBy: author?._id, decidedAt: new Date(), createdBy: author?._id || emp._id,
    });
  }
  console.log(`\n✅ გასწორდა: ${TYPE_KA[type]} ${short(fromS)}–${short(toS)} = ${want.length} დღე`);
} else if (!APPLY && (missing.length || extra.length)) {
  console.log("\nგასასწორებლად გაუშვი --apply-ით");
}
await mongoose.disconnect();
