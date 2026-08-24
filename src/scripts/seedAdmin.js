// One-off bootstrap script — creates the first admin Role + Employee so
// you have someone who can log in and start creating the rest of the
// team through the normal API. Run once, then you don't need it again.
//
// Usage:
//   node src/scripts/seedAdmin.js "First" "Last" "admin@yourcompany.com" "StrongPassword123!"

import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

// every resource key the real sidebar checks — admin gets full read+write
// on all of them
const ALL_RESOURCES = [
  "home", "plannings", "fullfill_plan", "receipe",
  "drugs", "product_types", "manufacturers", "manufacturer_countries",
  "doctors", "doctor_categories", "doctor_sub_categories", "hospitals",
  "pharmacies", "profiles", "prescriptions", "efficiency_report",
  "employees", "roles", "designations", "sections", "groups",
  "evaluation_criteria", "regions", "attendances", "sales",
  "reimbursement_report", "budgets", "employee_accounts",
  "employee_targets", "doctor_targets", "employee_sales", "doctor_sales",
];

function buildFullPrivileges() {
  const privileges = {};
  ALL_RESOURCES.forEach((key) => {
    privileges[key] = { read: 1, write: 1, dashboard: 1, live_feeds: 1, last_locations: 1, analytics: 1 };
  });
  return privileges;
}

async function seed() {
  const [firstName, lastName, email, password] = process.argv.slice(2);

  if (!firstName || !lastName || !email || !password) {
    console.error(
      'Usage: node src/scripts/seedAdmin.js "First" "Last" "email@example.com" "password"'
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  await connectDB();

  let adminRole = await Role.findOne({ name: "admin" });
  if (!adminRole) {
    adminRole = await Role.create({ name: "admin", privileges: buildFullPrivileges() });
    console.log("Created 'admin' role.");
  }

  const existing = await Employee.findOne({ email: email.toLowerCase() });
  if (existing) {
    console.log(`Employee with email ${email} already exists — nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  const employee = await Employee.create({
    firstName,
    lastName,
    email: email.toLowerCase(),
    password: hashed,
    role: adminRole._id,
    active: true,
  });

  console.log(`Admin created: ${employee.email} (id: ${employee._id})`);
  console.log("You can now log in with POST /api/auth/login using this email/password.");

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
