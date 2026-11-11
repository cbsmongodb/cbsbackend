// Read-only audit of one month of "Sales from pharmacies".
//   node src/scripts/checkSales.js 2026-10
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import EmployeeSale from "../models/EmployeeSale.js";
import MedicineTarget from "../models/MedicineTarget.js";
import Employee from "../models/Employee.js";
import Drug from "../models/Drug.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";

const month = process.argv[2] || "";
const mm = month.match(/^(\d{4})-(\d{2})$/);
if (!mm) { console.log("usage: node src/scripts/checkSales.js 2026-10"); process.exit(1); }
const H = 12 * 3600e3, y = +mm[1], m = +mm[2] - 1;
const win = { $gte: new Date(Date.UTC(y, m, 1) - H), $lt: new Date(Date.UTC(y, m + 1, 1) - H) };

await connectDB();
const sales = await EmployeeSale.find({ date: win }).lean();
const lines = await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((s) => s._id) } }).lean();
const drugs = new Map((await Drug.find({}).select("name price isActive").lean()).map((d) => [String(d._id), d]));
const emps = new Map((await Employee.find({}).select("firstName lastName isActive group").lean()).map((e) => [String(e._id), e]));
const secName = new Map((await Section.find({}).select("name").lean()).map((s) => [String(s._id), s.name]));
const groupSec = new Map((await Group.find({}).select("section").lean()).map((g) => [String(g._id), String(g.section || "")]));
const saleById = new Map(sales.map((s) => [String(s._id), s]));
const nm = (id) => { const e = emps.get(String(id)); return e ? `${e.firstName || ""} ${e.lastName || ""}`.trim() || "(no name)" : "(deleted employee)"; };

console.log(`\n=== ${month}: ${sales.length} sale documents, ${lines.length} drug lines ===`);
let tot = 0, totActive = 0, boxesAll = 0, boxesActive = 0;
const frac = [], byDiv = new Map(), byEmp = new Map(), dup = new Map(), big = [];
for (const l of lines) {
  const s = saleById.get(String(l.medicineTargatableId)); const d = drugs.get(String(l.drug)); const e = emps.get(String(s.employee));
  const amt = (l.totalNoOfBoxes || 0) * (d?.price || 0);
  tot += amt; boxesAll += l.totalNoOfBoxes || 0;
  const active = d?.isActive && e?.isActive;
  if (active) { totActive += amt; boxesActive += l.totalNoOfBoxes || 0; }
  if (!Number.isInteger(l.totalNoOfBoxes)) frac.push(`${nm(s.employee)} | ${d?.name} | ${l.totalNoOfBoxes} boxes | ${s.date.toISOString().slice(0, 10)}`);
  if (active) {
    const div = secName.get(groupSec.get(String(e.group || ""))) || "(no division)";
    byDiv.set(div, (byDiv.get(div) || 0) + amt);
    byEmp.set(nm(s.employee), (byEmp.get(nm(s.employee)) || 0) + amt);
    const k = `${s.employee}|${l.drug}|${s.date.toISOString().slice(0, 10)}|${l.totalNoOfBoxes}`;
    dup.set(k, (dup.get(k) || 0) + 1);
    big.push({ amt, txt: `${nm(s.employee)} | ${d.name} | ${l.totalNoOfBoxes} boxes x ${d.price} = ${Math.round(amt)} | ${s.date.toISOString().slice(0, 10)}` });
  }
}
console.log(`ALL drugs+employees : ${Math.round(tot)} GEL, ${boxesAll} boxes`);
console.log(`ACTIVE only (shown) : ${Math.round(totActive)} GEL, ${boxesActive} boxes`);
console.log(`\n-- by division (active only)`); [...byDiv].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${Math.round(v)}`));
console.log(`\n-- top 10 employees`); [...byEmp].sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, v]) => console.log(`  ${k}: ${Math.round(v)}`));
console.log(`\n-- 10 biggest lines`); big.sort((a, b) => b.amt - a.amt).slice(0, 10).forEach((x) => console.log("  " + x.txt));
const dups = [...dup].filter(([, c]) => c > 1);
console.log(`\n-- identical lines entered more than once (same person+drug+day+boxes): ${dups.length}`);
dups.slice(0, 15).forEach(([k, c]) => { const [e, d, day, b] = k.split("|"); console.log(`  x${c}: ${nm(e)} | ${drugs.get(d)?.name} | ${day} | ${b} boxes`); });
console.log(`\n-- lines with NON-whole boxes: ${frac.length}`); frac.slice(0, 20).forEach((x) => console.log("  " + x));
console.log(`\n-- prices: active drugs with price 0 that were sold: ${[...new Set(lines.filter((l) => drugs.get(String(l.drug))?.isActive && !drugs.get(String(l.drug))?.price).map((l) => drugs.get(String(l.drug)).name))].join(", ") || "none"}`);
await mongoose.disconnect();
