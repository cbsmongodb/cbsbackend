// Imports the per-doctor SALES (boxes) from the old CRM Data Entry into DoctorEntryItem.sale.
//   node src/scripts/importOldDataEntrySales.js ~/Downloads/data_entry_sales_2026_import.json           (dry run)
//   node src/scripts/importOldDataEntrySales.js ~/Downloads/data_entry_sales_2026_import.json --apply   (writes)
// Matches employee (name), doctor (ID), drug (name), month. Only the "sale" field is set;
// quota / prescription / budgets stay as they are. Safe to re-run.
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
if (!file) { console.error("Usage: node src/scripts/importOldDataEntrySales.js <file.json> [--apply]"); process.exit(1); }

const norm = (s) => String(s || "").toLowerCase()
  .replace(/x/g, "kh").replace(/w/g, "ts").replace(/q/g, "k").replace(/c/g, "ts").replace(/y/g, "k")
  .replace(/[^a-z\u10d0-\u10ff0-9]/g, "");

const rows = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`File: ${rows.length} sale lines | mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
await connectDB();

const empMap = new Map();
for (const e of await Employee.find({}, { firstName: 1, lastName: 1 }).lean()) {
  empMap.set(norm(`${e.firstName} ${e.lastName}`), e._id);
  empMap.set(norm(`${e.lastName} ${e.firstName}`), e._id);
}
const docMap = new Map((await Doctor.find({}, { uniqueNumber: 1, hospitals: 1 }).lean()).map((d) => [String(d.uniqueNumber).trim(), d]));
const drugsA = prepareDrugs(await Drug.find({}, { name: 1, price: 1 }).lean());
const drugCache = new Map();
const findDrug = (n) => { if (!drugCache.has(n)) drugCache.set(n, bestMatch(n, drugsA)); return drugCache.get(n); };

const miss = { emp: new Map(), doc: new Map(), drug: new Map() };
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const ops = [];
let boxes = 0, amount = 0;
for (const r of rows) {
  const emp = empMap.get(norm(r.employee));
  const doc = docMap.get(String(r.doctorNumber));
  const m = findDrug(r.drug);
  if (!emp) { bump(miss.emp, r.employee); continue; }
  if (!doc) { bump(miss.doc, `${r.doctorName} (${r.doctorNumber})`); continue; }
  if (!m.drug) { bump(miss.drug, r.drug); continue; }
  const [y, mo] = r.month.split("-").map(Number);
  const period = new Date(Date.UTC(y, mo - 1, 1));
  boxes += r.sale;
  amount += r.sale * (m.drug.price || 0);
  ops.push({ updateOne: {
    filter: { employee: emp, doctor: doc._id, drug: m.drug._id, period },
    update: { $set: { sale: r.sale }, $setOnInsert: { hospital: doc.hospitals?.length === 1 ? doc.hospitals[0].hospital : null } },
    upsert: true,
  } });
}

const show = (t, map) => { if (map.size) { console.log(`\n${t} (${map.size}):`); for (const [k, v] of map) console.log(`  ${v}x ${k}`); } };
console.log(`\nReady: ${ops.length} lines, ${boxes} boxes sold, about ${Math.round(amount).toLocaleString("en-US")} GEL at today's prices`);
show("Employees NOT found (skipped)", miss.emp);
show("Doctors NOT found (skipped)", miss.doc);
show("Drugs NOT found (skipped)", miss.drug);

if (!APPLY) {
  console.log("\nDRY RUN - nothing written. Re-run with --apply to import.");
} else {
  let inserted = 0, updated = 0;
  for (let i = 0; i < ops.length; i += 1000) {
    const res = await DoctorEntryItem.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    inserted += res.upsertedCount; updated += res.modifiedCount;
    console.log(`  ${Math.min(i + 1000, ops.length)} / ${ops.length}`);
  }
  console.log(`\nDONE: sales set on ${updated} existing lines, ${inserted} new lines.`);
}
await mongoose.disconnect();
