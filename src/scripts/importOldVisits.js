// Imports the old CRM visits (Employee Performance / Efficiency) as completed visit plans.
//   node src/scripts/importOldVisits.js ~/Downloads/visits_2026_v2_import.json           (dry run)
//   node src/scripts/importOldVisits.js ~/Downloads/visits_2026_v2_import.json --apply   (writes)
// One visit = date + employee + hospital + the doctors seen. Safe to re-run: the same
// visit is updated, never duplicated (imported plans are marked "[old-crm]").
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import PlanConfiguration from "../models/PlanConfiguration.js";
import PlanConfigurationDoctor from "../models/PlanConfigurationDoctor.js";
import Doctor from "../models/Doctor.js";
import Hospital from "../models/Hospital.js";
import Employee from "../models/Employee.js";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const APPLY = args.includes("--apply");
if (!file) { console.error("Usage: node src/scripts/importOldVisits.js <file.json> [--apply]"); process.exit(1); }
const TAG = "[old-crm]";

const norm = (s) => String(s || "").toLowerCase()
  .replace(/x/g, "kh").replace(/w/g, "ts").replace(/q/g, "k").replace(/c/g, "ts").replace(/y/g, "k")
  .replace(/[^a-z\u10d0-\u10ff0-9]/g, "");

const visits = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`File: ${visits.length} visits | mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
await connectDB();

const empMap = new Map();
for (const e of await Employee.find({}, { firstName: 1, lastName: 1 }).lean()) {
  empMap.set(norm(`${e.firstName} ${e.lastName}`), e._id);
  empMap.set(norm(`${e.lastName} ${e.firstName}`), e._id);
}
const docMap = new Map((await Doctor.find({}, { uniqueNumber: 1 }).lean()).map((d) => [String(d.uniqueNumber).trim(), d._id]));
const hospFull = new Map(), hospPart = new Map();
for (const h of await Hospital.find({}, { name: 1 }).lean()) {
  hospFull.set(norm(h.name), h._id);
  String(h.name).split("/").map((p) => norm(p)).filter((p) => p.length >= 4).forEach((p) => { if (!hospPart.has(p)) hospPart.set(p, h._id); });
}
const findHospital = (name) => hospFull.get(norm(name))
  || String(name || "").split("/").map((p) => hospPart.get(norm(p))).find(Boolean) || null;

const miss = { emp: new Map(), hosp: new Map() };
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const plans = [];
let doctorLinks = 0, docMissing = 0;
for (const v of visits) {
  const emp = empMap.get(norm(v.employee));
  if (!emp) { bump(miss.emp, v.employee); continue; }
  const hospital = findHospital(v.hospital);
  if (!hospital) bump(miss.hosp, v.hospital);
  const doctors = v.doctors.map((n) => docMap.get(String(n))).filter(Boolean);
  docMissing += v.doctors.length - doctors.length;
  if (!doctors.length) continue;
  const period = new Date(`${v.date}T10:00:00+04:00`);
  const comment = hospital ? TAG : `${TAG} ${v.hospital}`;
  plans.push({ emp, hospital, period, comment, doctors });
  doctorLinks += doctors.length;
}
const show = (t, m) => { if (m.size) { console.log(`\n${t} (${m.size}):`); [...m].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, n]) => console.log(`  ${n}x ${k}`)); } };
console.log(`\nReady: ${plans.length} visits with ${doctorLinks} doctor visits (doctors not found: ${docMissing})`);
show("Employees NOT found (skipped)", miss.emp);
show("Hospitals NOT found (visit kept, shown as unknown place)", miss.hosp);

if (!APPLY) {
  console.log("\nDRY RUN - nothing written. Re-run with --apply to import.");
} else {
  for (let i = 0; i < plans.length; i += 1000) {
    const chunk = plans.slice(i, i + 1000);
    await PlanConfiguration.bulkWrite(chunk.map((p) => ({ updateOne: {
      filter: { performer: p.emp, period: p.period, hospital: p.hospital, comment: p.comment },
      update: { $set: {
        planType: p.hospital ? "hospital" : "general", status: "completed",
        author: p.emp, performer: p.emp, employee: p.emp,
        iWentAt: p.period, iLeftAt: new Date(p.period.getTime() + 30 * 60000),
      } },
      upsert: true,
    } })), { ordered: false });
    const saved = await PlanConfiguration.find({ $or: chunk.map((p) => ({ performer: p.emp, period: p.period, hospital: p.hospital, comment: p.comment })) }).select("performer period hospital comment");
    const idOf = new Map(saved.map((s) => [`${s.performer}|${+s.period}|${s.hospital}|${s.comment}`, s._id]));
    const links = [];
    chunk.forEach((p) => {
      const id = idOf.get(`${p.emp}|${+p.period}|${p.hospital}|${p.comment}`);
      if (id) p.doctors.forEach((d) => links.push({ updateOne: {
        filter: { planConfiguration: id, doctor: d },
        update: { $set: { status: "completed" } },
        upsert: true,
      } }));
    });
    if (links.length) await PlanConfigurationDoctor.bulkWrite(links, { ordered: false });
    console.log(`  ${Math.min(i + 1000, plans.length)} / ${plans.length}`);
  }
  console.log(`\nDONE: ${plans.length} visits imported as completed.`);
}
await mongoose.disconnect();
