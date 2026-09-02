// One-off script — creates the real company groups (from the legacy
// system). Region is found-or-created by name; the "head" is matched by
// first+last name against existing employees — if no match is found,
// the group is still created, just without a head. Safe to re-run:
// skips any group name that already exists.
//
// Usage:
//   node src/scripts/seedGroups.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Group from "../models/Group.js";
import Region from "../models/Region.js";
import Employee from "../models/Employee.js";

const GROUPS = [
  { name: "H3", region: "tbilisi", employee: "Tamuna Gotciridze", status: "Active" },
  { name: "P3", region: "tbilisi", employee: "Tamar Gongadze", status: "Active" },
  { name: "H- REGIONS", region: "tbilisi", employee: "Ketevan Jalaghonia", status: "Active" },
  { name: "H1", region: "tbilisi", employee: "Cici Merabishvili", status: "Active" },
  { name: "P2", region: "tbilisi", employee: "Megi Tenadze", status: "Active" },
  { name: "H2", region: "tbilisi", employee: "Liza Gulashvili", status: "Active" },
  { name: "M1", region: "tbilisi", employee: "Sopho Qadjaia", status: "Active" },
  { name: "M3", region: "tbilisi", employee: "Tamuna Liparteliani", status: "Active" },
  { name: "M-REGIONS", region: "tbilisi", employee: "Rusudan Abzianidze", status: "Active" },
  { name: "P1", region: "tbilisi", employee: "Nana Berianidze", status: "Active" },
  { name: "Test", region: "samegrelo", employee: "Asif Khan", status: "Active" },
  { name: "M REGIONAL MANAGER", region: "Achara", employee: "Nana Nakaidze", status: "Active" },
  { name: "Virt. Regional Manager Division 1", region: "tbilisi", employee: "Tamuna Jinjolava", status: "Active" },
  { name: "P - REGIONS", region: "tbilisi", employee: "Tamuna Jinjolava", status: "Active" },
  { name: "DIVISION I FUND", region: "tbilisi", employee: "Tamuna Jinjolava", status: "Active" },
  { name: "DIVISION III FUND", region: "tbilisi", employee: "Ketevan Jalaghonia", status: "Active" },
  { name: "DIVISION II FUND", region: "tbilisi", employee: "Rusudan Abzianidze", status: "Active" },
  { name: "M2", region: "tbilisi", employee: "Lika Kavtaradze", status: "Active" },
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

  for (const row of GROUPS) {
    const existing = await Group.findOne({ name: row.name });
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
      console.log(`  Warning: no employee match for "${row.employee}" — creating group without a head.`);
    }

    await Group.create({
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
