// Division Manager = everything Group Manager has + the Administration
// block (scoped to their own division in the backend). Copies the CURRENT
// Group Manager privileges from the DB, so later changes made on the Roles
// page (e.g. director_dashboard turned off) carry over. Safe to re-run.
//   node src/scripts/setDivisionManagerRole.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const VIEW = { ...OFF, read: 1 };
const EDIT = { ...OFF, read: 1, add: 1, update: 1 };
const EDIT_DEL = { ...EDIT, delete: 1 };

const ADMINISTRATION = {
  employees: EDIT,
  groups: EDIT,
  leaves: EDIT_DEL,
  sections: VIEW,
  regions: VIEW,
  designations: VIEW,
  roles: OFF,
};

async function run() {
  await connectDB();
  const gm = await Role.findOne({ name: /^\s*group manager\s*$/i });
  const dm = await Role.findOne({ name: /^\s*division manager\s*$/i });
  if (!gm || !dm) {
    console.error("Missing role:", !gm ? "Group Manager" : "", !dm ? "Division Manager" : "");
    await mongoose.disconnect();
    process.exit(1);
  }

  const privileges = {};
  gm.privileges.forEach((v, k) => {
    const plain = v && typeof v.toObject === "function" ? v.toObject() : v;
    privileges[k] = { ...OFF, ...plain };
  });
  Object.entries(ADMINISTRATION).forEach(([k, v]) => { privileges[k] = v; });

  dm.privileges = privileges;
  dm.markModified("privileges");
  await dm.save();

  const visible = Object.keys(privileges).filter((k) => privileges[k].read).sort();
  console.log(`Division Manager updated. ${visible.length} pages visible:`);
  visible.forEach((k) => console.log("  -", k));

  const people = await Employee.find({ role: dm._id }).select("firstName lastName email");
  console.log(`\nEmployees with the Division Manager role (${people.length}):`);
  people.forEach((p) => console.log(`  - ${p.firstName} ${p.lastName} (${p.email})`));

  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
