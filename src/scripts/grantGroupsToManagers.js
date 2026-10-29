// Group managers and product managers see "Groups" and "Employees" in
// Administration — only their own group / division (scoped on the server).
// Groups: view + edit. Employees: view only.
//   node src/scripts/grantGroupsToManagers.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const BASE = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const GRANT = { groups: { read: 1, update: 1 }, employees: { read: 1 } };
const ROLE_NAMES = ["group manager", "product manager"];

await connectDB();
const roles = (await Role.find({})).filter((r) => ROLE_NAMES.includes(r.name.toLowerCase().trim()));
if (!roles.length) console.log("⚠️  Group Manager / Product Manager roles not found");
for (const role of roles) {
  for (const [key, on] of Object.entries(GRANT)) {
    const cur = role.privileges.get(key);
    const plain = cur ? (cur.toObject ? cur.toObject() : { ...cur }) : {};
    const next = { ...BASE, ...plain };
    for (const [k, v] of Object.entries(on)) next[k] = Math.max(next[k] || 0, v);
    role.privileges.set(key, next);
  }
  role.markModified("privileges");
  await role.save();
  const people = await Employee.find({ role: role._id, isActive: { $ne: false } }).select("firstName lastName").lean();
  console.log(`\n✅ ${role.name} (${people.length}): ჯგუფები (ნახვა+რედაქტირება), თანამშრომლები (ნახვა)`);
  people.forEach((p) => console.log(`   - ${p.firstName} ${p.lastName}`));
}
await mongoose.disconnect();
