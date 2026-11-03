// Who already has leave days entered? (read-only)
//   node src/scripts/listLeaves.js            (this year)
//   node src/scripts/listLeaves.js 2025       (another year)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import LeaveEntry from "../models/LeaveEntry.js";
import Employee from "../models/Employee.js";

const year = Number(process.argv[2]) || new Date().getFullYear();
const TYPE_KA = { paid: "შვებულება", unpaid: "არაანაზღ.", sick: "ბიულეტენი" };
const dayKey = (d) => new Date(new Date(d).getTime() + 12 * 3600e3).toISOString().slice(0, 10);
const from = new Date(Date.UTC(year, 0, 1) - 12 * 3600e3);
const to = new Date(Date.UTC(year + 1, 0, 1) - 12 * 3600e3);

function daysOf(l) {
  if (l.days?.length) return l.days.map((d) => ({ k: dayKey(d.date), t: d.type }));
  const out = [];
  const end = new Date(dayKey(l.endDate));
  for (let d = new Date(dayKey(l.startDate)); d <= end; d = new Date(+d + 86400000)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push({ k: dayKey(d), t: l.type });
  }
  return out;
}
// 2026-10-26,27,28 -> "26-28.10"
function ranges(keys) {
  const out = [];
  let a = null;
  let b = null;
  // next working day (Fri -> Mon), so a leave over a weekend stays one range
  const next = (k) => {
    let d = new Date(+new Date(k) + 86400000);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = new Date(+d + 86400000);
    return d.toISOString().slice(0, 10);
  };
  const fmt = (x, y) => (x === y ? `${x.slice(8)}.${x.slice(5, 7)}`
    : `${x.slice(8)}.${x.slice(5, 7)}-${y.slice(8)}.${y.slice(5, 7)}`);
  for (const k of keys) {
    if (b && k === next(b)) b = k;
    else { if (a) out.push(fmt(a, b)); a = k; b = k; }
  }
  if (a) out.push(fmt(a, b));
  return out.join(", ");
}

await connectDB();
const leaves = await LeaveEntry.find({
  startDate: { $lt: to },
  endDate: { $gte: from },
  status: { $in: ["approved", null] },
}).lean();
const ids = [...new Set(leaves.map((l) => String(l.employee)))];
const emps = await Employee.find({ _id: { $in: ids } }).select("firstName lastName email").lean();
const byId = new Map(emps.map((e) => [String(e._id), e]));

const per = new Map();
for (const l of leaves) {
  const key = String(l.employee);
  if (!per.has(key)) per.set(key, { paid: new Set(), unpaid: new Set(), sick: new Set() });
  daysOf(l).forEach(({ k, t }) => {
    if (k.startsWith(String(year)) && per.get(key)[t]) per.get(key)[t].add(k);
  });
}
const rows = [...per.entries()]
  .map(([id, v]) => ({ e: byId.get(id), v }))
  .sort((x, y) => `${x.e?.firstName}`.localeCompare(`${y.e?.firstName}`));

console.log(`\n${year}: leave days entered for ${rows.length} people\n`);
for (const { e, v } of rows) {
  console.log(`${e ? `${e.firstName} ${e.lastName}` : "?"}  <${e?.email || "-"}>`);
  for (const t of ["paid", "unpaid", "sick"]) {
    const ks = [...v[t]].sort();
    if (!ks.length) continue;
    const n = String(ks.length).padStart(3);
    console.log(`   ${TYPE_KA[t].padEnd(10)} ${n} დღე: ${ranges(ks)}`);
  }
}
await mongoose.disconnect();
