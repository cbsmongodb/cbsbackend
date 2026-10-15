// One-time import of hospitals (and other "places": office, leave, bank...)
// from the old system. Safe: the first run only REPORTS what it would do.
//
//   node src/scripts/importHospitals.js ~/Downloads/hospitals_import.json            (dry run)
//   node src/scripts/importHospitals.js ~/Downloads/hospitals_import.json --apply    (write)
//   add --no-geocode to skip looking up map coordinates (much faster)
//
// A hospital that already exists (same name, ignoring case / punctuation /
// Latin-Georgian spelling of either half "Latin / ქართული") is NOT duplicated;
// only its empty address / phone / email are filled in. Missing regions are created.
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Hospital from "../models/Hospital.js";
import Region from "../models/Region.js";

const file = process.argv[2];
const APPLY = process.argv.includes("--apply");
const GEOCODE = !process.argv.includes("--no-geocode");
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node src/scripts/importHospitals.js <hospitals_import.json> [--apply] [--no-geocode]');
  process.exit(1);
}

const GE = "აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ";
const LAT = ["a","b","g","d","e","v","z","t","i","k","l","m","n","o","p","zh","r","s","t","u","p","k","gh","q","sh","ch","ts","dz","ts","ch","kh","j","h"];
const TR = Object.fromEntries([...GE].map((c, i) => [c, LAT[i]]));
const key = (s) =>
  [...String(s || "").toLowerCase()].map((c) => TR[c] ?? c).join("")
    .replace(/x/g, "kh").replace(/w/g, "ts").replace(/q/g, "k").replace(/c/g, "ts").replace(/y/g, "k")
    .replace(/[^a-z0-9]/g, "");
const sideKeys = (name) => {
  const parts = String(name || "").split(/\s*\/\s*/).filter((p) => p.trim());
  return [key(name), ...parts.map(key)].filter((k) => k.length >= 4);
};
const regionKey = (s) => String(s || "").toLowerCase().replace(/[^a-z\u10a0-\u10ff]/g, "");

async function run() {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  await connectDB();

  const regions = await Region.find({});
  const regionBy = new Map(regions.map((r) => [regionKey(r.name), r]));
  const existing = await Hospital.find({}).select("name address phoneNumber email");
  const hospBy = new Map();
  existing.forEach((h) => sideKeys(h.name).forEach((k) => { if (!hospBy.has(k)) hospBy.set(k, h); }));

  const newRegions = new Set();
  const toCreate = [];
  const toFill = [];
  let alreadyComplete = 0;

  for (const r of rows) {
    const keys = [...sideKeys(r.name), ...(r.aliases || []).flatMap(sideKeys)];
    const match = keys.map((k) => hospBy.get(k)).find(Boolean);
    if (match) {
      const fill = {};
      if (!match.address && r.address) fill.address = r.address;
      if (!match.phoneNumber && r.phoneNumber) fill.phoneNumber = r.phoneNumber;
      if (!match.email && r.email) fill.email = r.email;
      if (Object.keys(fill).length) toFill.push({ hospital: match, fill, row: r });
      else alreadyComplete++;
      continue;
    }
    if (!regionBy.has(regionKey(r.region))) newRegions.add(r.region);
    toCreate.push(r);
    sideKeys(r.name).forEach((k) => hospBy.set(k, { name: r.name })); // guard against repeats in the file
  }

  console.log(`\nIn file: ${rows.length}  (of which ${rows.filter((r) => r.place).length} are places: office, leave...)`);
  console.log(`Already in the system: ${alreadyComplete + toFill.length}  (${toFill.length} get missing address/phone/email)`);
  console.log(`New, will be created: ${toCreate.length}`);
  console.log(`New regions: ${newRegions.size ? [...newRegions].join(", ") : "none"}`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Examples of new hospitals:");
    toCreate.slice(0, 10).forEach((r) => console.log(`  + ${r.name}  [${r.region}]`));
    toFill.slice(0, 5).forEach((x) => console.log(`  ~ ${x.hospital.name}: fill ${Object.keys(x.fill).join(", ")}`));
    console.log("\nRun again with --apply to write.");
    await mongoose.disconnect();
    return;
  }

  for (const name of newRegions) {
    const reg = await Region.create({ name, isActive: true });
    regionBy.set(regionKey(name), reg);
    console.log(`  region created: ${name}`);
  }
  for (const x of toFill) {
    await Hospital.updateOne({ _id: x.hospital._id }, { $set: x.fill });
  }

  let done = 0;
  const docs = toCreate.map((r) => ({
    name: r.name,
    region: regionBy.get(regionKey(r.region))._id,
    address: r.address || undefined,
    phoneNumber: r.phoneNumber || undefined,
    email: r.email || undefined,
    isActive: true,
  }));
  if (!GEOCODE) {
    await Hospital.insertMany(docs, { ordered: false });
    done = docs.length;
  } else {
    // one by one, so each address gets map coordinates (~0.6 s per hospital)
    for (const d of docs) {
      await new Hospital(d).save();
      done++;
      if (done % 50 === 0) console.log(`  ... ${done} / ${docs.length}`);
    }
  }
  console.log(`\nDONE — created ${done} hospitals, filled ${toFill.length}, regions created ${newRegions.size}.`);
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
