// One-time import of doctors (with hospital links) from the old system.
//
// Usage:
//   node src/scripts/importDoctors.js ~/Desktop/doctors_import.json            (dry run, writes nothing)
//   node src/scripts/importDoctors.js ~/Desktop/doctors_import.json --apply    (writes to DB)
//   optional: --status ~/Downloads/doctors.csv   (old CSV export; "Inactive" rows become isActive=false)
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Doctor from "../models/Doctor.js";
import Hospital from "../models/Hospital.js";
import Profile from "../models/Profile.js";
import DoctorCategory from "../models/DoctorCategory.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));
const APPLY = args.includes("--apply");
const statusIdx = args.indexOf("--status");
const statusFile = statusIdx >= 0 ? args[statusIdx + 1] : null;
if (!file) {
  console.error("Usage: node src/scripts/importDoctors.js <doctors_import.json> [--apply] [--status doctors.csv]");
  process.exit(1);
}

const GE = "აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ";
const LAT = ["a","b","g","d","e","v","z","t","i","k","l","m","n","o","p","zh","r","s","t","u","p","k","gh","q","sh","ch","ts","dz","ts","ch","kh","j","h"];
const TR = Object.fromEntries([...GE].map((c, i) => [c, LAT[i]]));
const key = (s) =>
  [...String(s || "").toLowerCase()].map((c) => TR[c] ?? c).join("")
    .replace(/x/g, "kh").replace(/w/g, "ts").replace(/q/g, "k").replace(/c/g, "ts").replace(/y/g, "k")
    .replace(/[^a-z0-9]/g, "");
const roman = (s) => {
  const m = String(s || "").toLowerCase().match(/\b(iii|ii|i)\b/);
  return m ? m[1] : null;
};

async function run() {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`File: ${rows.length} doctors | mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

  const inactive = new Set();
  if (statusFile) {
    for (const line of fs.readFileSync(statusFile, "utf8").split(/\r?\n/)) {
      const cols = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      if (cols.length > 2 && /inactive/i.test(cols[cols.length - 1])) inactive.add(cols[1].replace(/"/g, "").trim());
    }
    console.log(`Status file: ${inactive.size} inactive doctors`);
  }

  await connectDB();

  const hospitals = await Hospital.find({}, { name: 1 }).lean();
  const hMap = new Map();
  for (const h of hospitals) {
    const full = key(h.name);
    if (full) hMap.set(full, h._id);
    for (const part of h.name.split(/\s*\/\s*/)) {
      const k = key(part);
      if (k.length >= 5 && !hMap.has(k)) hMap.set(k, h._id);
    }
  }
  const findHospital = (name) => {
    const full = key(name);
    if (hMap.has(full)) return hMap.get(full);
    for (const part of name.split(/\s*\/\s*/)) {
      const k = key(part);
      if (k.length >= 5 && hMap.has(k)) return hMap.get(k);
    }
    return null;
  };

  const profMap = new Map((await Profile.find().lean()).map((p) => [key(p.name), p._id]));
  const getProfile = async (name) => {
    const k = key(name);
    if (profMap.has(k)) return profMap.get(k);
    const id = APPLY ? (await Profile.create({ name: name.trim() }))._id : new mongoose.Types.ObjectId();
    profMap.set(k, id);
    console.log(`  + profile: ${name}`);
    return id;
  };

  const catMap = new Map();
  for (const c of await DoctorCategory.find().lean()) {
    const r = roman(c.name);
    if (r && !catMap.has(r)) catMap.set(r, c._id);
  }
  const getCategory = async (name) => {
    const r = roman(name) || "ii";
    if (catMap.has(r)) return catMap.get(r);
    const label = `${r.toUpperCase()} კატეგორია`;
    const id = APPLY ? (await DoctorCategory.create({ name: label }))._id : new mongoose.Types.ObjectId();
    catMap.set(r, id);
    console.log(`  + category: ${label}`);
    return id;
  };

  const existing = new Map(
    (await Doctor.find({}, { uniqueNumber: 1, hospitals: 1 }).lean()).map((d) => [String(d.uniqueNumber).trim(), d])
  );
  console.log(`DB: ${hospitals.length} hospitals, ${existing.size} doctors already`);

  const toInsert = [];
  const updates = [];
  const missingHosp = new Map();
  let links = 0;

  for (const r of rows) {
    const hospIds = [];
    for (const name of r.hospitals || []) {
      const id = findHospital(name);
      if (id) { if (!hospIds.some((x) => String(x) === String(id))) hospIds.push(id); }
      else missingHosp.set(name, (missingHosp.get(name) || 0) + 1);
    }
    links += hospIds.length;
    const num = String(r.uniqueNumber).trim();
    const ex = existing.get(num);
    if (ex) {
      const have = new Set((ex.hospitals || []).map((h) => String(h.hospital)));
      const add = hospIds.filter((id) => !have.has(String(id)));
      if (add.length && ex._id) updates.push({ _id: ex._id, add });
      continue;
    }
    toInsert.push({
      firstName: r.firstName,
      lastName: r.lastName,
      uniqueNumber: num,
      profile: await getProfile(r.profile),
      doctorCategory: await getCategory(r.category),
      hospitals: hospIds.map((h) => ({ hospital: h })),
      isActive: !r.nonDoctor && !inactive.has(num),
    });
    existing.set(num, { _id: null, hospitals: [] });
  }

  console.log(`\nNew doctors: ${toInsert.length}`);
  console.log(`Existing doctors getting new hospital links: ${updates.length}`);
  console.log(`Hospital links found: ${links}`);
  if (missingHosp.size) {
    console.log(`Hospital names not found in DB (${missingHosp.size}):`);
    for (const [n, c] of [...missingHosp].sort((a, b) => b[1] - a[1])) console.log(`  ${c}x ${n}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN - nothing written. Re-run with --apply to import.");
  } else {
    let done = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const res = await Doctor.insertMany(toInsert.slice(i, i + 500), { ordered: false }).catch((e) => {
        console.error("  batch error:", e.message);
        return e.insertedDocs || [];
      });
      done += res.length;
      console.log(`  inserted ${done} / ${toInsert.length}`);
    }
    for (const u of updates) {
      await Doctor.updateOne({ _id: u._id }, { $push: { hospitals: { $each: u.add.map((h) => ({ hospital: h })) } } });
    }
    console.log(`\nDONE: ${done} doctors created, ${updates.length} updated.`);
  }
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
