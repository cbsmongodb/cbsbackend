// Gives the "Leave for payroll" report to: division managers, the director,
// the finance manager (finance@cbs.ge's role) and the office manager.
//   node src/scripts/grantLeavePayrollReport.js
// Prints everyone who will see it. Admins always see everything.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const KEY = "leave_payroll_report";
const ON = { read: 1, add: 0, update: 0, delete: 0, import: 0, export: 1, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const ROLE_NAMES = ["division manager", "director", "finance manager", "office manager"];

await connectDB();
const roles = await Role.find({}).lean();
const wanted = new Map();
for (const r of roles) if (ROLE_NAMES.includes(r.name.toLowerCase().trim())) wanted.set(String(r._id), r.name);
const tea = await Employee.findOne({ email: /^finance@cbs\.ge$/i }).populate("role", "name").lean();
if (tea?.role) wanted.set(String(tea.role._id), tea.role.name);
else console.log("⚠️  finance@cbs.ge not found — check the email");

for (const [id, name] of wanted) {
  const role = await Role.findById(id);
  role.privileges.set(KEY, ON);
  role.markModified("privileges");
  await role.save();
  const people = await Employee.find({ role: id, isActive: { $ne: false } }).select("firstName lastName email").lean();
  console.log(`\n✅ ${name} (${people.length}):`);
  people.forEach((p) => console.log(`   - ${p.firstName} ${p.lastName}  ${p.email || ""}`));
}
console.log("\nThese people now see the report (after logging out and back in).");
await mongoose.disconnect();
