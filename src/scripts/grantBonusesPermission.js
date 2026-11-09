// Who may open and edit the Bonuses page (privilege "drug_bonuses").
//   node src/scripts/grantBonusesPermission.js            -> shows what it would do
//   node src/scripts/grantBonusesPermission.js --apply    -> really grants
// Granted to the ROLES: director, division manager, group manager, and the
// roles of finance@cbs.ge and of "Kobelashvili". (Admin always has access.)
// Can be changed later on the Roles page (section "Sales entry" -> Bonuses).
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";
import { nameSearchFilter } from "../utils/nameSearch.js";

const APPLY = process.argv.includes("--apply");
const KEY = "drug_bonuses";
const FULL = { read: 1, add: 1, update: 1, delete: 1 };
const ROLE_NAMES = [/^director$/i, /division\s*manager/i, /group\s*manager/i];

await connectDB();
const roles = await Role.find({}).lean();
const pick = new Map();
roles.filter((r) => ROLE_NAMES.some((rx) => rx.test(r.name))).forEach((r) => pick.set(String(r._id), { role: r, why: "by role name" }));

const people = await Employee.find({
  $or: [{ email: /^finance@cbs\.ge$/i }, nameSearchFilter("Kobelashvili", ["firstName", "lastName"]), nameSearchFilter("ქობელაშვილი", ["firstName", "lastName"])],
}).select("firstName lastName email role").populate("role", "name").lean();
console.log("\nPeople found:");
people.forEach((p) => {
  console.log(`  ${p.firstName} ${p.lastName}  ${p.email || ""}  role: ${p.role?.name || "— (no role)"}`);
  if (p.role) {
    const r = roles.find((x) => String(x._id) === String(p.role._id));
    if (r && !pick.has(String(r._id))) pick.set(String(r._id), { role: r, why: `role of ${p.firstName} ${p.lastName}` });
  }
});
if (!people.length) console.log("  nobody (finance@cbs.ge / Kobelashvili not found)");

console.log(`\nRoles that get "${KEY}" (read, add, update, delete):`);
for (const { role, why } of pick.values()) {
  const count = await Employee.countDocuments({ role: role._id, isActive: { $ne: false } });
  console.log(`  ${role.name}  (${why}, ${count} active employees with this role)`);
}

if (!APPLY) {
  console.log("\nDRY RUN - nothing changed. Add --apply to grant.");
} else {
  for (const { role } of pick.values()) {
    await Role.updateOne({ _id: role._id }, { $set: { [`privileges.${KEY}`]: { ...FULL, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 } } });
  }
  console.log(`\nDONE - granted to ${pick.size} roles. Those users must log out and in again (or refresh) to see the page.`);
}
await mongoose.disconnect();
