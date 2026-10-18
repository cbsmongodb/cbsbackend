// Compares what the Budget Allotment page shows with what Data Entry actually holds.
//   node src/scripts/testBudgetAllotment.js you@cbs.ge 2026-06-01 2026-06-30
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Budget from "../models/Budget.js";
import Prescription from "../models/Prescription.js";
import DrugPrescription from "../models/DrugPrescription.js";
import DoctorTarget from "../models/DoctorTarget.js";
import MedicineTarget from "../models/MedicineTarget.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import "../models/Drug.js";
import "../models/Doctor.js";

const [email, from, to] = process.argv.slice(2);
if (!email || !from || !to) { console.error("Usage: node src/scripts/testBudgetAllotment.js <email> <YYYY-MM-DD> <YYYY-MM-DD>"); process.exit(1); }
await connectDB();
const emp = await Employee.findOne({ email: email.toLowerCase().trim() });
if (!emp) { console.error("no employee " + email); process.exit(1); }
const start = new Date(`${from}T00:00:00+04:00`), end = new Date(`${to}T23:59:59.999+04:00`);
const money = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US") + " GEL";
console.log(`\n${emp.firstName} ${emp.lastName}, ${from} .. ${to}\n`);

const budgets = await Budget.find({ employee: emp._id, date: { $gte: start, $lte: end } });
const paid = budgets.reduce((s, b) => s + (b.paidAmount || 0), 0);
const rx = await Prescription.find({ employee: emp._id, date: { $gte: start, $lte: end } }).select("_id");
const items = await DrugPrescription.find({ prescription: { $in: rx.map((p) => p._id) } }).populate("drug", "price");
let pageRx = 0, pageSales = 0;
items.forEach((it) => { pageRx += (it.totalNoOfBoxes || 0) * (it.drug?.price || 0); pageSales += (it.saleBoxes || 0) * (it.drug?.price || 0); });
const dts = await DoctorTarget.find({ employee: emp._id, date: { $gte: start, $lte: end } }).select("_id");
const trows = await MedicineTarget.find({ medicineTargatableType: "DoctorTarget", medicineTargatableId: { $in: dts.map((t) => t._id) } }).populate("drug", "price");
const pageTarget = trows.reduce((s, t) => s + (t.totalNoOfBoxes || 0) * (t.drug?.price || 0), 0);
console.log("PAGE SHOWS NOW (old Prescriptions / Doctor Targets pages):");
console.log(`  paid (budgets):      ${money(paid)}   from ${budgets.length} budget rows`);
console.log(`  target:              ${money(pageTarget)}   from ${dts.length} doctor targets`);
console.log(`  sales:               ${money(pageSales)}`);
console.log(`  prescriptions:       ${money(pageRx)}   from ${rx.length} prescriptions`);

const [fy, fm] = from.split("-").map(Number);
const mStart = new Date(Date.UTC(fy, fm - 1, 1));
const de = await DoctorEntryItem.find({ employee: emp._id, period: { $gte: mStart, $lte: end } }).populate("drug", "price");
let deRx = 0, deSales = 0, deTarget = 0, deBudget = 0;
const issuedByDoctorMonth = new Map();
de.forEach((it) => {
  const p = it.drug?.price || 0;
  deRx += (it.prescription || 0) * p;
  deSales += (it.sale || 0) * p;
  deTarget += (it.quota || 0) * p;
  deBudget += it.totalBudget || 0;
  issuedByDoctorMonth.set(`${it.doctor}|${new Date(it.period).toISOString().slice(0, 7)}`, it.issuedBudget || 0);
});
const deIssued = [...issuedByDoctorMonth.values()].reduce((s, v) => s + v, 0);
console.log("\nDATA ENTRY HAS (the real monthly data, incl. imported 2026):");
console.log(`  issued budget:       ${money(deIssued)}`);
console.log(`  planned budget:      ${money(deBudget)}`);
console.log(`  target (quota):      ${money(deTarget)}`);
console.log(`  sales:               ${money(deSales)}`);
console.log(`  prescriptions:       ${money(deRx)}   from ${de.length} lines`);
await mongoose.disconnect();
