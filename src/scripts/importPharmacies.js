
// One-time import of pharmacies from the old CRM.
//   node src/scripts/importPharmacies.js ~/Downloads/pharmacies.json            (dry run)
//   node src/scripts/importPharmacies.js ~/Downloads/pharmacies.json --apply    (write)
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Pharmacy from "../models/Pharmacy.js";
import Region from "../models/Region.js";

const file = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!file || !fs.existsSync(file)) {
  console.error("Usage: node src/scripts/importPharmacies.js <pharmacies.json> [--apply]");
  process.exit(1);
}

const nameKey = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
const regionKey = (s) => String(s || "").toLowerCase().replace(/[^a-z\u10a0-\u10ff]/g, "");
const clean = (s) => String(s || "").replace(/,?\s*грузия\s*$/i, "").replace(/\s+/g, " ").trim();

async function run() {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"))
    .map((r) => ({
      pharmacyName: clean(r.pharmacyName),
      region: clean(r.region) || "Tbilisi",
      address: clean(r.address),
      phoneNumber: clean(r.phoneNumber),
      email: clean(r.email),
      pharmacyCategory: clean(r.pharmacyCategory),
      isActive: String(r.status || "").trim().toLowerCase() !== "inactive",
    }))
    .filter((r) => r.pharmacyName);

  await connectDB();
  const regions = await Region.find({}).lean();
  const regionBy = new Map(regions.map((r) => [regionKey(r.name), r]));
  const existing = await Pharmacy.find({}).select("pharmacyName address phoneNumber email pharmacyCategory").lean();
  const byName = new Map(existing.map((p) => [nameKey(p.pharmacyName), p]));

  const newRegions = new Set();
  const toCreate = [];
  const toFill = [];
  let complete = 0;
  for (const r of rows) {
    const match = byName.get(nameKey(r.pharmacyName));
    if (match) {
      if (!match._id) continue;
      const fill = {};
      for (const f of ["address", "phoneNumber", "email", "pharmacyCategory"]) if (!match[f] && r[f]) fill[f] = r[f];
      if (Object.keys(fill).length) toFill.push({ id: match._id, fill });
      else complete++;
      continue;
    }
    if (!regionBy.has(regionKey(r.region))) newRegions.add(r.region);
    toCreate.push(r);
    byName.set(nameKey(r.pharmacyName), {});
  }

  console.log(`\nIn file: ${rows.length}`);
  console.log(`Already in the system: ${complete + toFill.length}  (${toFill.length} get missing fields)`);
  console.log(`New, will be created: ${toCreate.length}`);
  console.log(`New regions: ${newRegions.size ? [...newRegions].join(", ") : "none"}`);
  if (!APPLY) {
    console.log("\nDRY RUN — nothing written. Examples:");
    toCreate.slice(0, 10).forEach((r) => console.log(`  + ${r.pharmacyName}  [${r.region}]  ${r.address}`));
    console.log("\nRun again with --apply to write.");
    await mongoose.disconnect();
    return;
  }
  for (const name of newRegions) {
    const reg = await Region.create({ name, isActive: true });
    regionBy.set(regionKey(name), reg);
    console.log(`  region created: ${name}`);
  }
  if (toFill.length) await Pharmacy.bulkWrite(toFill.map((x) => ({ updateOne: { filter: { _id: x.id }, update: { $set: x.fill } } })));
  const docs = toCreate.map((r) => ({
    pharmacyName: r.pharmacyName,
    region: regionBy.get(regionKey(r.region))._id,
    address: r.address || undefined,
    phoneNumber: r.phoneNumber || undefined,
    email: r.email || undefined,
    pharmacyCategory: r.pharmacyCategory || undefined,
    isActive: r.isActive,
  }));
  await Pharmacy.insertMany(docs, { ordered: false });
  console.log(`\nDONE — created ${docs.length} pharmacies, filled ${toFill.length}, regions created ${newRegions.size}.`);
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
