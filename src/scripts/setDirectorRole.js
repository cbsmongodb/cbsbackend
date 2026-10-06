// Director = every page with every action (like admin), including the
// Director dashboard. Exception: Stocks stays VIEW ONLY — the monthly stock
// file is uploaded by the Accountant's assistant. The developer error monitor
// is locked to the developer's email, so no privilege can expose it.
// Data scope is already company-wide (Director is in GLOBAL_ROLES). Safe to re-run.
//   node src/scripts/setDirectorRole.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";

const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const FULL = { read: 1, add: 1, update: 1, delete: 1, import: 1, export: 1, dashboard: 1, live_feeds: 1, last_locations: 1, analytics: 1 };
const OVERRIDES = { stock_upload: { ...OFF, read: 1 } };

const KNOWN_KEYS = [
  "attendances", "attendance_report",
  "drugs", "product_types", "manufacturers", "manufacturer_countries", "stock_upload",
  "doctors", "doctor_categories", "doctor_sub_categories", "hospitals", "pharmacies", "profiles",
  "plannings", "plan_config", "sales", "budgets", "budget_requests",
  "efficiency_report", "reimbursement_report", "staff_performance_report", "analytics", "budgets_report", "director_dashboard",
  "prescriptions", "employee_accounts", "employee_targets", "employee_sales", "doctor_targets",
  "employees", "roles", "designations", "sections", "groups", "regions", "leaves",
];

async function run() {
  await connectDB();
  const role = await Role.findOne({ name: /^\s*director\s*$/i });
  if (!role) { console.error("No Director role"); await mongoose.disconnect(); process.exit(1); }

  // plus any extra key another role already uses, so nothing is missed
  const keys = new Set(KNOWN_KEYS);
  const all = await Role.find({}).select("privileges");
  all.forEach((r) => r.privileges?.forEach((_, k) => keys.add(k)));

  keys.forEach((k) => role.privileges.set(k, OVERRIDES[k] || FULL));
  role.markModified("privileges");
  await role.save();

  console.log(`Director updated: ${keys.size} pages`);
  [...keys].sort().forEach((k) => console.log(`  - ${k.padEnd(26)} ${OVERRIDES[k] ? "view only" : "full"}`));
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
