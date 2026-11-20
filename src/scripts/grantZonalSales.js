// Gives the "Zonal sales" report to: the director, division managers, finance@cbs.ge and
// lbogveradze12@gmail.com. Admins always see everything.
//   node src/scripts/grantZonalSales.js
// Division managers automatically see only their own division; the rest see all divisions.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const KEY = "zonal_sales";
const VIEW = { read: 1, add: 0, update: 0, delete: 0, import: 0, export: 1, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const UPLOAD = { ...VIEW, import: 1 }; // finance + me will upload the Excel
const ROLE_NAMES = ["division manager", "director"];
const UPLOADERS = [/^finance@cbs\.ge$/i, /^lbogveradze12@gmail\.com$/i];

await connectDB();
const wanted = new Map(); // roleId -> privileges
for (const r of await Role.find({}).lean()) {
  if (ROLE_NAMES.includes(r.name.toLowerCase().trim())) wanted.set(String(r._id), VIEW);
}
for (const email of UPLOADERS) {
  const emp = await Employee.findOne({ email }).populate("role", "name").lean();
  if (!emp) { console.log(`⚠️  no employee with email ${email}`); continue; }
  if (!emp.role) { console.log(`⚠️  ${emp.email} has no role`); continue; }
  wanted.set(String(emp.role._id), UPLOAD);
}

for (const [id, priv] of wanted) {
  const role = await Role.findById(id);
  if (role.name === "admin") { console.log(`ℹ️  admin already sees everything`); continue; }
  role.privileges.set(KEY, priv);
  role.markModified("privileges");
  await role.save();
  const people = await Employee.find({ role: id, isActive: { $ne: false } }).select("firstName lastName email").lean();
  console.log(`\n✅ ${role.name}${priv.import ? " (+ Excel upload)" : ""} — ${people.length} people:`);
  people.forEach((p) => console.log(`   - ${p.firstName} ${p.lastName}  ${p.email || ""}`));
}
console.log("\nThey see 'ზონალური გაყიდვები' after logging out and back in.");
await mongoose.disconnect();
