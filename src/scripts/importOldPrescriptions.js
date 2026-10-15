// One-time import of prescriptions from the old CRM into Data Entry (DoctorEntryItem).
//   node src/scripts/importOldPrescriptions.js ~/Downloads/prescriptions_2026_import.json           (dry run)
//   node src/scripts/importOldPrescriptions.js ~/Downloads/prescriptions_2026_import.json --apply   (writes)
// One line = employee + doctor + drug + month, prescribed boxes summed.
// Existing Data Entry lines are NOT touched (safe to re-run).
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import Doctor from "../models/Doctor.js";
import Drug from "../models/Drug.js";
import Employee from "../models/Employee.js";
import { bestMatch, prepareDrugs } from "../utils/drugNameMatch.js";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const APPLY = args.includes("--apply");
if (!file) {
  console.error("Usage: node src/scripts/importOldPrescriptions.js <file.json> [--apply]");
  process.exit(1);
}

const norm = (s) =>
  String(s || "").toLowerCase()
    .replace(/x/g, "kh").replace(/w/g, "ts").replace(/q/g, "k").replace(/c/g, "ts").replace(/y/g, "k")
    .replace(/[^a-z\u10d0-\u10ff]/g, "");

async function run() {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`File: ${rows.length} lines | mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  await connectDB();

  const employees = await Employee.find({}, { firstName: 1, lastName: 1 }).lean();
  const empMap = new Map();
  for (const e of employees) {
    empMap.set(norm(`${e.firstName} ${e.lastName}`), e._id);
    empMap.set(norm(`${e.lastName} ${e.firstName}`), e._id);
  }

  const doctors = await Doctor.find({}, { uniqueNumber: 1, hospitals: 1 }).lean();
  const docMap = new Map(doctors.map((d) => [String(d.uniqueNumber).trim(), d]));

  const drugsA = prepareDrugs(await Drug.find({}, { name: 1 }).lean());
  const drugCache = new Map();
  const findDrug = (name) => {
    if (!drugCache.has(name)) drugCache.set(name, bestMatch(name, drugsA));
    return drugCache.get(name);
  };

  const missEmp = new Map(), missDoc = new Map(), missDrug = new Map(), guessed = new Map();
  const ops = [];
  let boxes = 0;

  for (const r of rows) {
    const emp = empMap.get(norm(r.employee));
    const doc = docMap.get(String(r.doctorNumber));
    const m = findDrug(r.drug);
    if (!emp) { missEmp.set(r.employee, (missEmp.get(r.employee) || 0) + 1); continue; }
    if (!doc) { missDoc.set(r.doctorName, (missDoc.get(r.doctorName) || 0) + 1); continue; }
    if (!m.drug) { missDrug.set(r.drug, (missDrug.get(r.drug) || 0) + 1); continue; }
    if (m.guessed) guessed.set(r.drug, m.drug.name);

    const [y, mo] = r.month.split("-").map(Number);
    const period = new Date(Date.UTC(y, mo - 1, 1));
    const hospital = doc.hospitals?.length === 1 ? doc.hospitals[0].hospital : null;
    boxes += r.prescription;
    ops.push({
      updateOne: {
        filter: { employee: emp, doctor: doc._id, drug: m.drug._id, period },
        update: { $setOnInsert: { employee: emp, doctor: doc._id, drug: m.drug._id, period, hospital, prescription: r.prescription, sale: 0 } },
        upsert: true,
      },
    });
  }

  const show = (title, map) => {
    if (!map.size) return;
    console.log(`\n${title} (${map.size}):`);
    for (const [k, v] of map) console.log(typeof v === "number" ? `  ${v}x ${k}` : `  ${k}  =>  ${v}`);
  };
  console.log(`\nReady to import: ${ops.length} lines, ${boxes} boxes`);
  show("Employees NOT found (lines skipped)", missEmp);
  show("Doctors NOT found (lines skipped)", missDoc);
  show("Drugs NOT found (lines skipped)", missDrug);
  show("Drugs matched by similar name - check these", guessed);

  if (!APPLY) {
    console.log("\nDRY RUN - nothing written. Re-run with --apply to import.");
  } else {
    let inserted = 0, existed = 0;
    for (let i = 0; i < ops.length; i += 1000) {
      const res = await DoctorEntryItem.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      inserted += res.upsertedCount;
      existed += res.matchedCount;
      console.log(`  ${Math.min(i + 1000, ops.length)} / ${ops.length}`);
    }
    console.log(`\nDONE: ${inserted} new Data Entry lines, ${existed} already existed (left unchanged).`);
  }
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
