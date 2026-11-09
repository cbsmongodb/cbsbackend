// Merge doctors that are in the database more than once.
//
//   node src/scripts/mergeDuplicateDoctors.js                       -> DRY RUN, all groups (changes nothing)
//   node src/scripts/mergeDuplicateDoctors.js --only "nino ciskarishvili,ketevan mikeladze"
//   node src/scripts/mergeDuplicateDoctors.js --only "..." --apply  -> really merges those
//   node src/scripts/mergeDuplicateDoctors.js --apply               -> really merges every SAFE group
//
// For every group of same-name doctors:
//  - the KEEPER is the most-used record (budgets > entries > visits > old data)
//  - everything of the other records (entries, budgets, visits, old prescriptions,
//    old targets, recipes, hospitals, pharmacies) is moved onto the keeper
//  - the other records are NOT deleted: they are switched off, emptied and get
//    a note "[MERGED -> <keeper id>]"
// A group is SKIPPED (left for a human) when two used records work in
// different hospitals (could be two different people with the same name) or
// when both already have an entry line for the same employee + drug + month.
// --apply first writes a full backup to ~/Desktop/doctor-merge-backup-<time>.json
import "dotenv/config";
import fs from "fs";
import os from "os";
import path from "path";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Doctor from "../models/Doctor.js";
import Budget from "../models/Budget.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import PlanConfigurationDoctor from "../models/PlanConfigurationDoctor.js";
import PlanConfigurationDoctorDrug from "../models/PlanConfigurationDoctorDrug.js";
import Prescription from "../models/Prescription.js";
import DoctorTarget from "../models/DoctorTarget.js";
import Recipe from "../models/Recipe.js";
import { syncIssuedBudgetSafe } from "../utils/budgetSync.js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const onlyArg = args[args.indexOf("--only") + 1];
const norm = (s) => String(s || "").toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
const nameOf = (d) => norm(`${d.firstName || ""} ${d.lastName || ""}`);
const ONLY = args.includes("--only") && onlyArg ? onlyArg.split(",").map(norm).filter(Boolean) : null;

const MOVE = { DoctorEntryItem, Budget, PlanConfigurationDoctor, PlanConfigurationDoctorDrug, Prescription, DoctorTarget, Recipe };

await connectDB();

const doctors = await Doctor.find({}).lean();
const groups = new Map();
for (const d of doctors) {
  const k = nameOf(d);
  if (ONLY && !ONLY.includes(k)) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(d);
}
const dupGroups = [...groups.values()].filter((g) => g.length > 1);
const ids = dupGroups.flat().map((d) => d._id);

const countBy = async (Model) => {
  const rows = await Model.aggregate([{ $match: { doctor: { $in: ids } } }, { $group: { _id: "$doctor", n: { $sum: 1 } } }]);
  return new Map(rows.map((r) => [String(r._id), r.n]));
};
const counts = {};
for (const [name, Model] of Object.entries(MOVE)) counts[name] = await countBy(Model);
const usage = (d) => {
  const id = String(d._id);
  const c = (n) => counts[n].get(id) || 0;
  return {
    budgets: c("Budget"), entries: c("DoctorEntryItem"), visits: c("PlanConfigurationDoctor"),
    old: c("Prescription") + c("DoctorTarget") + c("Recipe") + c("PlanConfigurationDoctorDrug"),
  };
};
const score = (u) => u.budgets * 1e6 + u.entries * 1e3 + u.visits * 10 + u.old;
const hospSet = (d) => new Set((d.hospitals || []).map((h) => String(h.hospital)));

const plan = [];
const review = [];
for (const g of dupGroups) {
  const ranked = g
    .map((d) => ({ d, u: usage(d) }))
    .sort((a, b) =>
      score(b.u) - score(a.u) ||
      Number(!!b.d.isBudgeted) - Number(!!a.d.isBudgeted) ||
      hospSet(b.d).size - hospSet(a.d).size ||
      new Date(a.d.createdAt || 0) - new Date(b.d.createdAt || 0)
    );
  const keeper = ranked[0];
  const others = ranked.slice(1);
  const kh = hospSet(keeper.d);

  let why = null;
  for (const o of others) {
    const used = score(o.u) > 0;
    const oh = hospSet(o.d);
    if (used && kh.size && oh.size && ![...oh].some((h) => kh.has(h))) {
      why = "used records work in DIFFERENT hospitals (maybe 2 different people)";
      break;
    }
  }
  if (!why) {
    // the same employee + drug + month on both -> the unique index would refuse the move
    const keepLines = await DoctorEntryItem.find({ doctor: keeper.d._id }).select("employee drug period").lean();
    const keys = new Set(keepLines.map((l) => `${l.employee}|${l.drug}|${+new Date(l.period)}`));
    const otherLines = await DoctorEntryItem.find({ doctor: { $in: others.map((o) => o.d._id) } }).select("employee drug period").lean();
    const seen = new Set(keys);
    for (const l of otherLines) {
      const k = `${l.employee}|${l.drug}|${+new Date(l.period)}`;
      if (seen.has(k)) { why = "both have an entry line for the same employee + drug + month"; break; }
      seen.add(k);
    }
  }
  (why ? review : plan).push({ keeper, others, why });
}

const label = (x) =>
  `${x.d._id} #${x.d.uniqueNumber} budgets ${x.u.budgets} · entries ${x.u.entries} · visits ${x.u.visits} · old ${x.u.old}`;
for (const p of plan) {
  console.log(`\nMERGE  ${p.keeper.d.firstName} ${p.keeper.d.lastName}`);
  console.log(`   keep  ${label(p.keeper)}`);
  p.others.forEach((o) => console.log(`   into  ${label(o)}`));
}
for (const r of review) {
  console.log(`\nSKIP   ${r.keeper.d.firstName} ${r.keeper.d.lastName}  -> ${r.why}`);
  [r.keeper, ...r.others].forEach((o) => console.log(`         ${label(o)}`));
}
console.log(`\n${plan.length} groups can be merged, ${review.length} need a human look.`);

if (!APPLY) {
  console.log("DRY RUN - nothing was changed. Add --apply to really merge.");
  await mongoose.disconnect();
  process.exit(0);
}

// ---------------- APPLY ----------------
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(os.homedir(), "Desktop", `doctor-merge-backup-${stamp}.json`);
const backup = [];
for (const p of plan) {
  const otherIds = p.others.map((o) => o.d._id);
  const moved = {};
  for (const [name, Model] of Object.entries(MOVE)) {
    moved[name] = (await Model.find({ doctor: { $in: otherIds } }).select("_id doctor").lean()).map((x) => ({ _id: x._id, from: x.doctor }));
  }
  backup.push({ keeper: p.keeper.d, others: p.others.map((o) => o.d), moved });
}
fs.writeFileSync(backupFile, JSON.stringify(backup, null, 1));
console.log(`\nBackup saved: ${backupFile}`);

let done = 0;
for (const p of plan) {
  const keeperId = p.keeper.d._id;
  const otherIds = p.others.map((o) => o.d._id);

  // budgets / entries that move -> their months need the issued budget re-synced
  const syncKeys = [
    ...(await Budget.find({ doctor: { $in: otherIds } }).select("employee date").lean()),
    ...(await DoctorEntryItem.find({ doctor: { $in: otherIds } }).select("employee period").lean()).map((e) => ({ employee: e.employee, date: e.period })),
  ];

  for (const Model of Object.values(MOVE)) {
    await Model.updateMany({ doctor: { $in: otherIds } }, { $set: { doctor: keeperId } });
  }

  // hospitals / pharmacies / flags onto the keeper
  // (updateOne, not save(): some imported doctors miss required fields and
  //  a full validation would refuse the whole record)
  const keeper = await Doctor.findById(keeperId).select("hospitals pharmacies isBudgeted isActive").lean();
  const hospitals = [...(keeper.hospitals || [])];
  const pharmacies = [...(keeper.pharmacies || [])];
  const have = new Set(hospitals.map((h) => String(h.hospital)));
  const pharm = new Set(pharmacies.map(String));
  let isBudgeted = !!keeper.isBudgeted;
  let isActive = !!keeper.isActive;
  for (const o of p.others) {
    for (const h of o.d.hospitals || []) {
      if (h.hospital && !have.has(String(h.hospital))) {
        hospitals.push({ hospital: h.hospital, floor: h.floor, room: h.room, additionalInfo: h.additionalInfo });
        have.add(String(h.hospital));
      }
    }
    for (const ph of o.d.pharmacies || []) {
      if (!pharm.has(String(ph))) { pharmacies.push(ph); pharm.add(String(ph)); }
    }
    if (o.d.isBudgeted) isBudgeted = true;
    if (o.d.isActive) isActive = true;
  }
  await Doctor.updateOne({ _id: keeperId }, { $set: { hospitals, pharmacies, isBudgeted, isActive } });

  // the duplicates: switched off and emptied, never deleted
  for (const o of p.others) {
    await Doctor.updateOne(
      { _id: o.d._id },
      { $set: { isActive: false, isBudgeted: false, hospitals: [], pharmacies: [], note: `[MERGED -> ${keeperId}] ${o.d.note || ""}`.trim() } }
    );
  }

  const uniq = new Map();
  syncKeys.forEach((k) => uniq.set(`${k.employee}|${+new Date(k.date)}`, { employee: k.employee, doctor: keeperId, date: k.date }));
  await syncIssuedBudgetSafe(...uniq.values());

  done++;
  console.log(`merged ${done}/${plan.length}: ${p.keeper.d.firstName} ${p.keeper.d.lastName}`);
}
console.log(`\nDONE - ${done} groups merged. Backup: ${backupFile}`);
await mongoose.disconnect();
