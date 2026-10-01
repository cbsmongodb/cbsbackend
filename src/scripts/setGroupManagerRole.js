// One-off: set the "Group Manager" role's privileges to the agreed set.
// Safe to re-run — it overwrites the Group Manager privileges each time.
//   node src/scripts/setGroupManagerRole.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";

const FULL = { read: 1, add: 1, update: 1, delete: 1, import: 1, export: 1, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const VIEW = { read: 1, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const EDIT = { read: 1, add: 1, update: 1, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const OFF  = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };

const ALL_KEYS = [
  "attendances",
  "drugs", "product_types", "manufacturers", "manufacturer_countries",
  "doctors", "doctor_categories", "doctor_sub_categories", "hospitals", "pharmacies", "profiles",
  "plannings", "plan_config", "sales", "budgets", "budget_requests",
  "efficiency_report", "reimbursement_report", "staff_performance_report", "analytics", "budgets_report", "director_dashboard",
  "prescriptions", "employee_accounts", "employee_targets", "employee_sales", "doctor_targets",
  "employees", "roles", "designations", "sections", "groups", "regions", "leaves",
];

const GROUP_MANAGER = {
  attendances: VIEW,
  drugs: FULL, product_types: FULL, manufacturers: FULL, manufacturer_countries: FULL,
  doctors: FULL, doctor_categories: FULL, doctor_sub_categories: FULL,
  hospitals: FULL, pharmacies: FULL, profiles: FULL,
  plannings: FULL, plan_config: VIEW, sales: FULL, budgets: EDIT, budget_requests: VIEW,
  efficiency_report: VIEW, reimbursement_report: VIEW, staff_performance_report: VIEW,
  analytics: VIEW, budgets_report: VIEW, director_dashboard: VIEW,
  prescriptions: VIEW, employee_accounts: VIEW, employee_targets: FULL, employee_sales: FULL, doctor_targets: OFF,
  employees: OFF, roles: OFF, designations: OFF, sections: OFF, groups: OFF, regions: OFF, leaves: OFF,
};

async function run() {
  await connectDB();
  const role = await Role.findOne({ name: new RegExp("^group manager$", "i") });
  if (!role) {
    console.error('No role named "Group Manager" found.');
    await mongoose.disconnect();
    process.exit(1);
  }
  const privileges = {};
  ALL_KEYS.forEach((key) => { privileges[key] = GROUP_MANAGER[key] || OFF; });
  role.privileges = privileges;
  await role.save();
  const enabled = ALL_KEYS.filter((k) => privileges[k].read).length;
  console.log(`Group Manager role updated. ${enabled} pages visible (read):`);
  ALL_KEYS.filter((k) => privileges[k].read).forEach((k) => console.log(`  - ${k}`));
  await mongoose.disconnect();
}
run().catch((err) => { console.error("Failed:", err); process.exit(1); });
