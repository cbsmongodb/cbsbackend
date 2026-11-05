// Gives the "Visits list" report (read + export) to: division managers,
// the director and the role of lbogveradze12@gmail.com. Admins always see everything.
//   node src/scripts/grantVisitsReport.js
// Division managers automatically see only their own division's people.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const KEY = "visits_report";
const ON = { read: 1, add: 0, update: 0, delete: 0, import: 0, export: 1, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const ROLE_NAMES = ["division manager", "director"];

await connectDB();
const roles = await Role.find({}).lean();
const wanted = new Map();
for (const r of roles) if (ROLE_NAMES.includes(r.name.toLowerCase().trim())) wanted.set(String(r._id), r.name);
const me = await Employee.findOne({ email: /^lbogveradze12@gmail\.com$/i }).populate("role", "name").lean();
if (me?.role) wanted.set(String(me.role._id), me.role.name);

for (const [id, name] of wanted) {
  const role = await Role.findById(id);
  if (role.name === "admin") { console.log(`ℹ️  admin already sees everything`); continue; }
  role.privileges.set(KEY, ON);
  role.markModified("privileges");
  await role.save();
  const people = await Employee.find({ role: id, isActive: { $ne: false } }).select("firstName lastName email").lean();
  console.log(`\n✅ ${name} (${people.length}):`);
  people.forEach((p) => console.log(`   - ${p.firstName} ${p.lastName}  ${p.email || ""}`));
}
console.log("\nThey see 'ვიზიტების სია' after logging out and back in.");
await mongoose.disconnect();
