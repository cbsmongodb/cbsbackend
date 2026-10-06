// Sales Manager: check-in / check-out on the dashboard (automatic — no visit
// planning rights), own leave balance on the dashboard (everyone has it), and
// the attendance report — only their own records (SELF_ONLY_ROLES in
// groupVisibility.js). Only these two keys are touched. Safe to re-run.
//   node src/scripts/setSalesManagerRole.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };

async function run() {
  await connectDB();
  const role = await Role.findOne({ name: /^\s*sales\s+manager\s*$/i });
  if (!role) { console.error("No Sales Manager role"); await mongoose.disconnect(); process.exit(1); }
  role.privileges.set("attendance_report", { ...OFF, read: 1 });
  role.privileges.set("attendances", OFF); // no Live Feed / Team Status
  role.markModified("privileges");
  await role.save();

  const pages = [];
  role.privileges.forEach((v, k) => { if (v && v.read === 1) pages.push(k); });
  console.log(`Sales Manager — pages: ${pages.sort().join(", ") || "none"}`);
  const people = await Employee.find({ role: role._id }).select("firstName lastName employeeType isActive");
  people.forEach((p) => console.log(`  - ${p.firstName} ${p.lastName}  (type: ${p.employeeType}, active: ${p.isActive})`));
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
