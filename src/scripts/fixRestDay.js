// Marks a date as a rest day (holiday) and removes it from everyone's leave.
//   node src/scripts/fixRestDay.js 2026-08-28 "მარიამობა"           (check only)
//   node src/scripts/fixRestDay.js 2026-08-28 "მარიამობა" --apply   (write)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import LeaveEntry from "../models/LeaveEntry.js";
import RestDay from "../models/RestDay.js";
import Employee from "../models/Employee.js";

const [dateS, label = ""] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!/^\d{4}-\d{2}-\d{2}$/.test(dateS || "")) {
  console.error('Usage: node src/scripts/fixRestDay.js 2026-08-28 "მარიამობა" [--apply]');
  process.exit(1);
}
const H12 = 12 * 3600e3;
const dayKey = (d) => new Date(+new Date(d) + H12).toISOString().slice(0, 10);
const toDay = (s) => new Date(`${s}T00:00:00.000Z`);
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

const day = toDay(dateS);
const exists = await RestDay.findOne({ date: { $gte: new Date(+day - H12), $lte: new Date(+day + H12) } }).lean();
if (exists) console.log(`ℹ️  ${dateS} უკვე დასვენების დღეა (${exists.label || ""})`);
else {
  console.log(`➕ ${dateS} დაემატება დასვენების დღედ: ${label}`);
  if (APPLY) {
    const author = await Employee.findOne({ email: "lbogveradze12@gmail.com" }).select("_id").lean();
    await RestDay.create({ date: day, label, createdBy: author._id });
  }
}

const entries = await LeaveEntry.find({
  startDate: { $lte: new Date(+day + H12) },
  endDate: { $gte: new Date(+day - H12) },
});
const hit = entries.filter((e) => daysOf(e).some(({ k }) => k === dateS));
const emps = await Employee.find({ _id: { $in: hit.map((e) => e.employee) } }).select("firstName lastName").lean();
const name = new Map(emps.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`]));

console.log(`\n${dateS} შვებულებად ჩათვლილი აქვს ${hit.length} ადამიანს — მოეხსნება (ბალანსს 1 დღე დაუბრუნდება):`);
for (const e of hit) {
  const ds = daysOf(e);
  const t = ds.find(({ k }) => k === dateS).t;
  console.log(`   - ${name.get(String(e.employee)) || e.employee}  (${TYPE_KA[t] || t}, ${ds.length} → ${ds.length - 1} დღე)`);
  if (!APPLY) continue;
  const keep = ds.filter(({ k }) => k !== dateS);
  if (!keep.length) { await LeaveEntry.deleteOne({ _id: e._id }); continue; }
  const ks = keep.map((x) => x.k).sort();
  e.days = keep.map(({ k, t: tt }) => ({ date: toDay(k), type: tt }));
  e.daysCount = keep.length;
  e.startDate = toDay(ks[0]);
  e.endDate = toDay(ks[ks.length - 1]);
  await e.save();
}
console.log(APPLY ? "\n✅ ჩაიწერა" : "\nყველაფერი სწორია? გაუშვი --apply-ით");
await mongoose.disconnect();
