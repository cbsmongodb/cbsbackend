// Which doctors are in the database more than once? (read-only, changes nothing)
//   node src/scripts/findDuplicateDoctors.js
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Doctor from "../models/Doctor.js";
import Hospital from "../models/Hospital.js";
import Budget from "../models/Budget.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import PlanConfigurationDoctor from "../models/PlanConfigurationDoctor.js";
import Prescription from "../models/Prescription.js";
import DoctorTarget from "../models/DoctorTarget.js";

// "(DEDA)" stays part of the name, so mother/daughter are not grouped together
const norm = (d) =>
  `${d.firstName || ""} ${d.lastName || ""}`.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();

await connectDB();

const doctors = await Doctor.find({})
  .select("firstName lastName uniqueNumber isActive isBudgeted hospitals.hospital createdAt")
  .lean();
const groups = new Map();
for (const d of doctors) {
  const k = norm(d);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(d);
}
const dupGroups = [...groups.values()].filter((g) => g.length > 1);
const ids = dupGroups.flat().map((d) => d._id);

const countBy = async (Model) => {
  const rows = await Model.aggregate([{ $match: { doctor: { $in: ids } } }, { $group: { _id: "$doctor", n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
};
const [entries, budgets, visits, rx, targets] = await Promise.all(
  [DoctorEntryItem, Budget, PlanConfigurationDoctor, Prescription, DoctorTarget].map(countBy)
);
const hospIds = [...new Set(dupGroups.flat().flatMap((d) => (d.hospitals || []).map((h) => String(h.hospital))))];
const hospName = new Map((await Hospital.find({ _id: { $in: hospIds } }).select("name").lean()).map((h) => [String(h._id), h.name]));

const csv = [["group", "doctor id", "name", "unique number", "active", "budgeted", "entry lines", "budgets", "visits", "old prescriptions", "old targets", "hospitals", "created"]];
dupGroups.sort((a, b) => norm(a[0]).localeCompare(norm(b[0])));
dupGroups.forEach((g, gi) => {
  console.log(`\n#${gi + 1}  ${g[0].firstName} ${g[0].lastName}  (${g.length} records)`);
  for (const d of g) {
    const id = String(d._id);
    const hs = (d.hospitals || []).map((h) => hospName.get(String(h.hospital)) || "?").join("; ");
    const nums = { e: entries.get(id) || 0, b: budgets.get(id) || 0, v: visits.get(id) || 0, p: rx.get(id) || 0, t: targets.get(id) || 0 };
    const used = nums.e + nums.b + nums.v + nums.p + nums.t;
    console.log(
      `   ${id}  #${d.uniqueNumber}  active=${!!d.isActive} budgeted=${!!d.isBudgeted}  ` +
      `entries ${nums.e} · budgets ${nums.b} · visits ${nums.v} · old rx ${nums.p} · old targets ${nums.t}` +
      `${used === 0 ? "  <-- not used anywhere" : ""}\n      hospitals: ${hs || "—"}`
    );
    csv.push([gi + 1, id, `${d.firstName} ${d.lastName}`, d.uniqueNumber, !!d.isActive, !!d.isBudgeted, nums.e, nums.b, nums.v, nums.p, nums.t, hs, d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : ""]);
  }
});

const file = path.join(os.homedir(), "Desktop", "duplicate-doctors.csv");
fs.writeFileSync(file, "\uFEFF" + csv.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"));
console.log(`\n${doctors.length} doctors, ${dupGroups.length} names appear more than once (${ids.length} records).`);
console.log(`Saved: ${file}`);
await mongoose.disconnect();
