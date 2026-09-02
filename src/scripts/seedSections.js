// One-off script — creates the real company sections (from the legacy
// system). Region is found-or-created by name; the "head" (manager) is
// matched by first+last name against existing employees — if no match
// is found, the section is still created, just without a head. Safe to
// re-run: skips any section name that already exists.
//
// Usage:
//   node src/scripts/seedSections.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Section from "../models/Section.js";
import Region from "../models/Region.js";
import Employee from "../models/Employee.js";

const SECTIONS = [
  { name: "1 DIVIZION", region: "tbilisi", employee: "Tamuna Jinjolava", status: "Active" },
  { name: "3 DIVIZION", region: "tbilisi", employee: "Ketevan Jalaghonia", status: "Active" },
  { name: "2 DIVIZION", region: "tbilisi", employee: "Rusudan Abzianidze", status: "Active" },
  { name: "Test Division", region: "kakheti", employee: "Sajjad Khan", status: "Active" },
];

async function run() {
  await connectDB();

  const allEmployees = await Employee.find().select("firstName lastName");
  function findEmployeeByName(name) {
    const target = name.trim().toLowerCase();
    return allEmployees.find(
      (e) => `${e.firstName} ${e.lastName}`.trim().toLowerCase() === target
    );
  }

  const regionCache = new Map();
  let created = 0;
  let skipped = 0;

  for (const row of SECTIONS) {
    const existing = await Section.findOne({ name: row.name });
    if (existing) {
      console.log(`Skipped (already exists): ${row.name}`);
      skipped++;
      continue;
    }

    let regionId;
    const regionKey = row.region.toLowerCase();
    if (regionCache.has(regionKey)) {
      regionId = regionCache.get(regionKey);
    } else {
      let region = await Region.findOne({ name: new RegExp(`^${row.region}$`, "i") });
      if (!region) {
        region = await Region.create({ name: row.region });
        console.log(`Created region: ${row.region}`);
      }
      regionId = region._id;
      regionCache.set(regionKey, regionId);
    }

    const match = findEmployeeByName(row.employee);
    if (!match) {
      console.log(`  Warning: no employee match for "${row.employee}" — creating section without a head.`);
    }

    await Section.create({
      name: row.name,
      region: regionId,
      head: match ? match._id : null,
      isActive: row.status.trim().toLowerCase() === "active",
    });
    console.log(`Created: ${row.name}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
