// Which drugs are in "Sales (from pharmacies)" for a month, and why.
//   node src/scripts/checkSalesDrugs.js 2026-10        (read-only, changes nothing)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import EmployeeSale from "../models/EmployeeSale.js";
import MedicineTarget from "../models/MedicineTarget.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import Drug from "../models/Drug.js";
import Group from "../models/Group.js";
import "../models/Employee.js";

const ym = process.argv[2] || new Date().toISOString().slice(0, 7);
const [y, m] = ym.split("-").map(Number);
const pad = (n) => String(n).padStart(2, "0");
const from = new Date(new Date(`${y}-${pad(m)}-01T00:00:00+04:00`).getTime() - 12 * 3600e3);
const to = new Date(new Date(`${m === 12 ? y + 1 : y}-${pad(m === 12 ? 1 : m + 1)}-01T00:00:00+04:00`).getTime() - 12 * 3600e3);

await connectDB();
const sales = await EmployeeSale.find({ date: { $gte: from, $lt: to } }).populate("employee", "firstName lastName").lean();
const lines = await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((s) => s._id) } }).lean();
const saleById = new Map(sales.map((s) => [String(s._id), s]));
const drugs = new Map((await Drug.find({}).select("name price isActive createdAt").lean()).map((d) => [String(d._id), d]));
const inGroups = new Set((await Group.find({}).select("drugs").lean()).flatMap((g) => (g.drugs || []).map(String)));
const monthStart = new Date(Date.UTC(y, m - 1, 1));
const entered = new Set((await DoctorEntryItem.distinct("drug", { period: { $gte: new Date(+monthStart - 864e5), $lte: new Date(+monthStart + 864e5) } })).map(String));

const by = new Map();
for (const l of lines) {
  const k = String(l.drug);
  const r = by.get(k) || { boxes: 0, lines: 0, reps: new Set(), created: [] };
  r.boxes += l.totalNoOfBoxes || 0; r.lines++;
  const s = saleById.get(String(l.medicineTargatableId));
  if (s?.employee) r.reps.add(`${s.employee.firstName} ${s.employee.lastName}`);
  if (l.createdAt) r.created.push(new Date(l.createdAt));
  by.set(k, r);
}
console.log(`\n${ym}: ${sales.length} sales entries, ${lines.length} lines, ${by.size} drugs\n`);
console.log("drug".padEnd(34), "boxes".padStart(7), " active  in-groups  in-prescriptions  entered-on            reps");
const rows = [...by.entries()].map(([id, r]) => ({ id, r, d: drugs.get(id) })).sort((a, b) => b.r.boxes - a.r.boxes);
for (const { id, r, d } of rows) {
  const dates = r.created.sort((a, b) => a - b);
  const when = dates.length ? `${dates[0].toISOString().slice(0, 10)}…${dates.at(-1).toISOString().slice(0, 10)}` : "—";
  console.log(
    (d?.name || `❌ NOT IN DRUGS (${id})`).slice(0, 33).padEnd(34),
    String(r.boxes).padStart(7),
    ` ${d?.isActive ? "yes" : "NO "}    ${inGroups.has(id) ? "yes" : "NO "}        ${entered.has(id) ? "yes" : "NO "}             ${when.padEnd(22)}`,
    [...r.reps].slice(0, 3).join(", ") + (r.reps.size > 3 ? ` +${r.reps.size - 3}` : "")
  );
}
await mongoose.disconnect();
