// Division managers: edit + delete drugs, doctors, employees; edit groups.
// (employees / groups stay limited to their own division on the server)
//   check:  node src/scripts/grantDivisionManagerEdit.js
//   do it:  node src/scripts/grantDivisionManagerEdit.js --apply
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const APPLY = process.argv.includes("--apply");
const BASE = {
  read: 0, add: 0, update: 0, delete: 0, import: 0,
  export: 0, dashboard: 0, live_feeds: 0,
  last_locations: 0, analytics: 0,
};
const GRANT = {
  drugs: { read: 1, update: 1, delete: 1 },
  doctors: { read: 1, update: 1, delete: 1 },
  employees: { read: 1, update: 1, delete: 1 },
  groups: { read: 1, update: 1 },
};
const KEYS = ["read", "add", "update", "delete"];
const plain = (v) => (v ? (v.toObject ? v.toObject() : { ...v }) : {});
const show = (p) => KEYS.map((k) => `${k}:${p[k] || 0}`).join(" ");

await connectDB();

// whose role is it really? (Rusudan first)
const rus = await Employee.findOne({
  firstName: /^rusudan$/i,
  lastName: /^abzianidze$/i,
}).populate("role", "name").lean();
console.log("\nRusudan Abzianidze role: " + (rus?.role?.name || "not found"));

const roles = (await Role.find({})).filter((r) => {
  const n = r.name.toLowerCase().trim();
  return n === "division manager" || n.startsWith("division manager ");
});
if (!roles.length) console.log("Division Manager role not found");

for (const role of roles) {
  const people = await Employee.find({ role: role._id, isActive: { $ne: false } })
    .select("firstName lastName").lean();
  console.log(`\n== ${role.name} (${people.length} people)`);
  people.forEach((p) => console.log(`   - ${p.firstName} ${p.lastName}`));
  for (const [key, on] of Object.entries(GRANT)) {
    const cur = { ...BASE, ...plain(role.privileges.get(key)) };
    const next = { ...cur };
    for (const [k, v] of Object.entries(on)) next[k] = Math.max(next[k] || 0, v);
    console.log(`   ${key.padEnd(10)} now  ${show(cur)}`);
    console.log(`   ${"".padEnd(10)} new  ${show(next)}`);
    role.privileges.set(key, next);
  }
  if (APPLY) {
    role.markModified("privileges");
    await role.save();
    console.log("   saved");
  }
}
if (!APPLY) console.log("\n(check only - add --apply to save)");
else console.log("\ndone - they should refresh the page");
await mongoose.disconnect();
