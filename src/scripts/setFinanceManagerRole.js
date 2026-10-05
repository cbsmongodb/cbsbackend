// Finance Manager = every page with every action, like admin.
// Data scope is already global for this role (seesEverything in
// groupVisibility.js). The developer error monitor stays developer-only:
// it is locked to the developer's email in both frontend and backend,
// not to a privilege, so nothing here can expose it. Safe to re-run.
//   node src/scripts/setFinanceManagerRole.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";

const FULL = { read: 1, add: 1, update: 1, delete: 1, import: 1, export: 1, dashboard: 1, live_feeds: 1, last_locations: 1, analytics: 1 };

// every key the Roles page knows about
const KNOWN_KEYS = [
  "attendances",
  "drugs", "product_types", "manufacturers", "manufacturer_countries",
  "doctors", "doctor_categories", "doctor_sub_categories", "hospitals", "pharmacies", "profiles",
  "plannings", "plan_config", "sales", "budgets", "budget_requests",
  "efficiency_report", "reimbursement_report", "staff_performance_report", "analytics", "budgets_report", "director_dashboard",
  "prescriptions", "employee_accounts", "employee_targets", "employee_sales", "doctor_targets",
  "employees", "roles", "designations", "sections", "groups", "regions", "leaves",
];

async function run() {
  await connectDB();
  const role = await Role.findOne({ name: /^\s*finance manager\s*$/i });
  if (!role) { console.error("No Finance Manager role"); await mongoose.disconnect(); process.exit(1); }

  // plus any extra key some other role already uses, so nothing is missed
  const keys = new Set(KNOWN_KEYS);
  const all = await Role.find({}).select("privileges");
  all.forEach((r) => r.privileges?.forEach((_, k) => keys.add(k)));

  keys.forEach((k) => role.privileges.set(k, FULL));
  role.markModified("privileges");
  await role.save();

  console.log(`Finance Manager updated: FULL access on ${keys.size} pages:`);
  [...keys].sort().forEach((k) => console.log("  -", k));
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
