// Opens the "Prescriptions" report for representatives (read + Excel export).
// The report itself shows a representative only their own entries.
//   node src/scripts/grantRepPrescriptionsReport.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const KEY = "prescriptions_report";
const BASE = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };

await connectDB();
const roles = (await Role.find({})).filter((r) => r.name.toLowerCase().trim() === "representative");
if (!roles.length) console.log("⚠️  Representative role not found");
for (const role of roles) {
  const cur = role.privileges.get(KEY);
  const plain = cur ? (cur.toObject ? cur.toObject() : { ...cur }) : {};
  role.privileges.set(KEY, { ...BASE, ...plain, read: 1, export: 1 });
  role.markModified("privileges");
  await role.save();
  const n = await Employee.countDocuments({ role: role._id, isActive: { $ne: false } });
  console.log(`✅ ${role.name}: რეცეპტების რეპორტი ჩაირთო (${n} თანამშრომელი)`);
}
console.log("წარმომადგენლებმა ერთხელ გამოსვლა/შესვლა უნდა გააკეთონ, რომ მენიუში გამოჩნდეს.");
await mongoose.disconnect();
