// Do approved leaves really show on the Timesheet (ტაბელი)? (read-only)
//   node src/scripts/checkTimesheetLeaves.js 2026-10
// Shows, for that month:
//   1) every leave and on which timesheet it appears (and with what code)
//   2) leaves of people who are on NO timesheet (they can't appear anywhere)
//   3) days where a hand-typed value hides the leave
//   4) timesheet rows not linked to a CRM employee (leaves never reach them)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import LeaveEntry from "../models/LeaveEntry.js";
import Employee from "../models/Employee.js";
import TimesheetMember from "../models/TimesheetMember.js";
import TimesheetCell from "../models/TimesheetCell.js";

const m = String(process.argv[2] || "").match(/^(\d{4})-(\d{2})$/);
if (!m) {
  console.error("Usage: node src/scripts/checkTimesheetLeaves.js 2026-10");
  process.exit(1);
}
const year = +m[1];
const month = +m[2];
const CODE = { paid: "ა/შ", unpaid: "უხ/შ", sick: "ს/ფ" };
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const pre = `${year}-${String(month).padStart(2, "0")}`;
const from = new Date(Date.UTC(year, month - 1, 1));
const to = new Date(Date.UTC(year, month, 0, 23, 59, 59));

function leaveDays(e) {
  if (e.days?.length) return e.days.map((d) => ({ k: dayKey(d.date), t: d.type }));
  const out = [];
  for (let d = new Date(dayKey(e.startDate)); d <= new Date(dayKey(e.endDate)); d = new Date(+d + 86400000)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push({ k: dayKey(d), t: e.type });
  }
  return out;
}

await connectDB();
const leaves = await LeaveEntry.find({
  startDate: { $lte: to },
  endDate: { $gte: from },
  status: { $in: ["approved", null] },
}).lean();
const members = await TimesheetMember.find({}).select("sheet employee nameKa").lean();
const byEmp = new Map();
members.forEach((x) => {
  if (!x.employee) return;
  const k = String(x.employee);
  if (!byEmp.has(k)) byEmp.set(k, []);
  byEmp.get(k).push(x);
});
const emps = await Employee.find({ _id: { $in: leaves.map((l) => l.employee) } })
  .select("firstName lastName").lean();
const name = new Map(emps.map((e) => [String(e._id), `${e.firstName} ${e.lastName}`]));
const cells = await TimesheetCell.find({
  member: { $in: members.map((x) => x._id) },
  date: { $regex: `^${pre}-` },
}).lean();
const cellBy = new Map(cells.map((c) => [`${c.member}|${c.date}`, c.value]));

console.log(`\n${pre}: ${leaves.length} approved leave entries\n`);
let missing = 0;
let hidden = 0;
for (const l of leaves) {
  const who = name.get(String(l.employee)) || String(l.employee);
  const days = leaveDays(l).filter((d) => d.k.startsWith(pre));
  if (!days.length) continue;
  const rows = byEmp.get(String(l.employee)) || [];
  const list = days.map((d) => d.k.slice(8)).join(",");
  if (!rows.length) {
    missing++;
    console.log(`❌ ${who}: ${list} - არცერთ ტაბელში არ არის (ვერ გამოჩნდება)`);
    continue;
  }
  for (const r of rows) {
    const over = days.filter((d) => {
      const v = cellBy.get(`${r._id}|${d.k}`);
      return v !== undefined && v !== CODE[d.t];
    });
    const codes = [...new Set(days.map((d) => CODE[d.t]))].join(" ");
    console.log(`✅ ${who} -> ${r.sheet} (${r.nameKa}): ${list}  [${codes}]`);
    over.forEach((d) => {
      hidden++;
      const v = cellBy.get(`${r._id}|${d.k}`);
      console.log(`   ⚠️ ${d.k.slice(8)}: ხელით ჩაწერილია "${v}" - შვებულება აქ არ ჩანს`);
    });
  }
}
const unlinked = members.filter((x) => !x.employee);
console.log(`\nტაბელის ხაზები CRM თანამშრომლის გარეშე: ${unlinked.length}`);
unlinked.forEach((x) => console.log(`   - ${x.sheet}: ${x.nameKa}`));
console.log(`\nარცერთ ტაბელში არ არის: ${missing}, ხელით გადაწერილი დღე: ${hidden}`);
await mongoose.disconnect();
