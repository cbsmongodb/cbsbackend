// Read-only: prints which pages a role can see and what it can do there.
//   node src/scripts/checkRolePrivileges.js "Representative"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const name = process.argv[2];
if (!name) { console.error('Usage: node src/scripts/checkRolePrivileges.js "Role Name"'); process.exit(1); }

async function run() {
  await connectDB();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const role = await Role.findOne({ name: new RegExp(`^\\s*${escaped}\\s*$`, "i") });
  if (!role) { console.error("Role not found:", name); await mongoose.disconnect(); process.exit(1); }

  const ACTIONS = ["read", "add", "update", "delete", "import", "export"];
  const rows = [];
  role.privileges.forEach((v, k) => {
    const on = ACTIONS.filter((a) => v && v[a] === 1);
    if (on.length) rows.push([k, on.join(", ")]);
  });
  rows.sort((a, b) => a[0].localeCompare(b[0]));

  console.log(`\n${role.name} — ${rows.length} page(s) with any access:`);
  rows.forEach(([k, a]) => console.log(`  - ${k.padEnd(26)} ${a}`));

  const count = await Employee.countDocuments({ role: role._id });
  console.log(`\nEmployees with this role: ${count}`);
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
