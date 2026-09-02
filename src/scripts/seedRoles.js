// One-off script — creates the real company roles (from the legacy
// system) as empty-privilege Role documents, ready to configure via the
// "როლები და უფლებები" admin page. Safe to re-run: skips any role name
// that already exists.
//
// Usage:
//   node src/scripts/seedRoles.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";

const ROLE_NAMES = [
  "Director",
  "Sales Manager",
  "Representative",
  "Division Manager",
  "Office",
  "Regulatory",
  "Product Manager",
  "Group Manager",
  "System Administrator",
  "Office Manager",
  "Accounts and Logistics",
  "Warehouse Manager",
  "Head Pharmacist",
  "Finance Manager",
  "Accountant's assistant",
  "Aesthetics Team",
  "Regional Manager",
];

function emptyPrivileges() {
  const RESOURCE_KEYS = [
    "home", "attendances", "plannings", "sales", "budgets", "drugs", "product_types",
    "manufacturers", "manufacturer_countries", "doctors", "doctor_categories", "doctor_sub_categories",
    "hospitals", "pharmacies", "profiles", "efficiency_report", "reimbursement_report",
    "employees", "roles", "designations", "sections", "groups", "regions", "leaves",
  ];
  const p = {};
  RESOURCE_KEYS.forEach((key) => {
    p[key] = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
  });
  return p;
}

async function run() {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const name of ROLE_NAMES) {
    const existing = await Role.findOne({ name });
    if (existing) {
      console.log(`Skipped (already exists): ${name}`);
      skipped++;
      continue;
    }
    await Role.create({ name, privileges: emptyPrivileges() });
    console.log(`Created: ${name}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
