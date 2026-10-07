// "Self-service" office roles: check-in / check-out on the dashboard (automatic —
// they have no visit-planning rights), own leave balance on the dashboard, and
// the attendance report with ONLY their own records (SELF_ONLY_ROLES in
// groupVisibility.js). Only attendance_report and attendances are touched, so
// pages added later on the Roles page stay. Safe to re-run.
//   node src/scripts/setSelfServiceRoles.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const ROLES = ["Sales Manager", "Aesthetics Team", "Head Pharmacist", "Warehouse Manager", "Accounts and Logistics", "Regulatory"];
const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function run() {
  await connectDB();
  for (const name of ROLES) {
    const role = await Role.findOne({ name: new RegExp(`^\\s*${esc(name)}\\s*$`, "i") });
    if (!role) { console.log(`! role not found: ${name}`); continue; }
    role.privileges.set("attendance_report", { ...OFF, read: 1 });
    role.privileges.set("attendances", OFF); // no Live Feed / Team Status
    role.markModified("privileges");
    await role.save();
    const people = await Employee.find({ role: role._id }).select("firstName lastName isActive");
    console.log(`${role.name}: attendance report (own) — ${people.length} employee(s)`);
    people.forEach((p) => console.log(`    ${p.firstName} ${p.lastName}${p.isActive ? "" : "   <-- INACTIVE, cannot log in"}`));
  }
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
