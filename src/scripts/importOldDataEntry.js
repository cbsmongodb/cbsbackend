// One-time import of the old CRM "Doctor Sale Entries" (Data Entry) into DoctorEntryItem.
//   node src/scripts/importOldDataEntry.js ~/Downloads/data_entry_2026_import.json           (dry run)
//   node src/scripts/importOldDataEntry.js ~/Downloads/data_entry_2026_import.json --apply   (writes)
// Data Entry is the official monthly record and knows the exact doctor (by ID):
//  - its lines are written/updated (quota, prescription, coefficient, bonus, budgets, bank, visits, hospital)
//  - same employee+drug+month on a same-named DUPLICATE doctor (from the prescriptions import) is removed,
//    only if untouched (no quota, no sale, no budget), so nothing is counted twice
//  - all other prescription-import lines stay; existing sales are never changed
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import Doctor from "../models/Doctor.js";
import Drug from "../models/Drug.js";
import Employee from "../models/Employee.js";
import Hospital from "../models/Hospital.js";
import { bestMatch, prepareDrugs } from "../utils/drugNameMatch.js";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const APPLY = args.includes("--apply");
if (!file) { console.error("Usage: node src/scripts/importOldDataEntry.js <file.json> [--apply]"); process.exit(1); }

const norm = (s) => String(s || "").toLowerCase()
  .replace(/x/g, "kh").replace(/w/g, "ts").replace(/q/g, "k").replace(/c/g, "ts").replace(/y/g, "k")
  .replace(/[^a-z\u10d0-\u10ff0-9]/g, "");
const half = (name) => String(name || "").split(/\s*\/\s*/).map(norm).filter((k) => k.length >= 5);

async function run() {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`File: ${rows.length} lines | mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  await connectDB();

  const empMap = new Map();
  for (const e of await Employee.find({}, { firstName: 1, lastName: 1 }).lean()) {
    empMap.set(norm(`${e.firstName} ${e.lastName}`), e._id);
    empMap.set(norm(`${e.lastName} ${e.firstName}`), e._id);
  }
  const allDocs = await Doctor.find({}, { uniqueNumber: 1, hospitals: 1, firstName: 1, lastName: 1 }).lean();
  const docMap = new Map(allDocs.map((d) => [String(d.uniqueNumber).trim(), d]));
  const byName = new Map();
  for (const d of allDocs) {
    const k = norm(`${d.firstName} ${d.lastName}`);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(d._id);
  }
  const hospMap = new Map();
  for (const h of await Hospital.find({}, { name: 1 }).lean()) {
    hospMap.set(norm(h.name), h._id);
    for (const k of half(h.name)) if (!hospMap.has(k)) hospMap.set(k, h._id);
  }
  const findHospital = (name, doc) => {
    if (name) {
      if (hospMap.has(norm(name))) return hospMap.get(norm(name));
      for (const k of half(name)) if (hospMap.has(k)) return hospMap.get(k);
    }
    return doc.hospitals?.length === 1 ? doc.hospitals[0].hospital : null;
  };
  const drugsA = prepareDrugs(await Drug.find({}, { name: 1 }).lean());
  const drugCache = new Map();
  const findDrug = (n) => { if (!drugCache.has(n)) drugCache.set(n, bestMatch(n, drugsA)); return drugCache.get(n); };

  const missEmp = new Map(), missDoc = new Map(), missDrug = new Map(), guessed = new Map();
  const ops = [];
  const twinFilters = [];
  for (const r of rows) {
    const emp = empMap.get(norm(r.employee));
    const doc = docMap.get(String(r.doctorNumber));
    const m = findDrug(r.drug);
    if (!emp) { missEmp.set(r.employee, (missEmp.get(r.employee) || 0) + 1); continue; }
    if (!doc) { missDoc.set(`${r.doctorName} (${r.doctorNumber})`, (missDoc.get(`${r.doctorName} (${r.doctorNumber})`) || 0) + 1); continue; }
    if (!m.drug) { missDrug.set(r.drug, (missDrug.get(r.drug) || 0) + 1); continue; }
    if (m.guessed) guessed.set(r.drug, m.drug.name);
    const [y, mo] = r.month.split("-").map(Number);
    const period = new Date(Date.UTC(y, mo - 1, 1));
    const twins = (byName.get(norm(`${doc.firstName} ${doc.lastName}`)) || []).filter((id) => String(id) !== String(doc._id));
    if (twins.length) twinFilters.push({ employee: emp, drug: m.drug._id, period, doctor: { $in: twins }, quota: 0, sale: 0, totalBudget: 0, issuedBudget: 0 });
    const set = {
      hospital: findHospital(r.clinic, doc),
      quota: r.quota, prescription: r.prescription, coefficient: r.coefficient, budget: r.budget, totalBudget: r.totalBudget,
      issuedBudget: r.issuedBudget, plannedBudget: r.plannedBudget, difference: r.difference, budgetCalculation: r.budgetCalculation,
      analysisOfCurrentMonth: r.analysisCM, analysisOfPreviousMonth: r.analysisPM, visits: r.visits || undefined,
    };
    if (r.bank) set.bank = r.bank;
    ops.push({ updateOne: {
      filter: { employee: emp, doctor: doc._id, drug: m.drug._id, period },
      update: { $set: set, $setOnInsert: { sale: 0 } },
      upsert: true,
    } });
  }

  const chunks = [];
  for (let i = 0; i < twinFilters.length; i += 200) chunks.push({ $or: twinFilters.slice(i, i + 200) });
  let toRemove = 0;
  for (const f of chunks) toRemove += await DoctorEntryItem.countDocuments(f);

  const show = (title, map) => {
    if (!map.size) return;
    console.log(`\n${title} (${map.size}):`);
    for (const [k, v] of map) console.log(typeof v === "number" ? `  ${v}x ${k}` : `  ${k}  =>  ${v}`);
  };
  console.log(`\nDuplicate-doctor twin lines to remove: ${toRemove}`);
  console.log(`Data Entry lines to write: ${ops.length}`);
  show("Employees NOT found (skipped)", missEmp);
  show("Doctors NOT found (skipped)", missDoc);
  show("Drugs NOT found (skipped)", missDrug);
  show("Drugs matched by similar name - check these", guessed);

  if (!APPLY) {
    console.log("\nDRY RUN - nothing written. Re-run with --apply to import.");
  } else {
    let removed = 0;
    for (const f of chunks) removed += (await DoctorEntryItem.deleteMany(f)).deletedCount;
    let inserted = 0, updated = 0;
    for (let i = 0; i < ops.length; i += 1000) {
      const res = await DoctorEntryItem.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
      inserted += res.upsertedCount; updated += res.modifiedCount;
      console.log(`  ${Math.min(i + 1000, ops.length)} / ${ops.length}`);
    }
    console.log(`\nDONE: removed ${removed} duplicate-doctor lines, wrote ${inserted} new + ${updated} updated Data Entry lines.`);
  }
  await mongoose.disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
