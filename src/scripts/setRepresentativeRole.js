// Representative privileges (agreed Oct 2026). Only the keys listed in
// CHANGES are touched — everything else (budgets, plannings, sales, ...)
// keeps whatever it currently has. Safe to re-run.
//   node src/scripts/setRepresentativeRole.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";

const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const VIEW = { ...OFF, read: 1 };
const EDIT = { ...OFF, read: 1, add: 1, update: 1 };

const CHANGES = {
  // sees everyone, can add + edit, cannot delete
  doctors: EDIT,
  hospitals: EDIT,
  pharmacies: EDIT,
  // own group's drugs only (backend filters by Employee.group), view only
  drugs: VIEW,
  // reference lists — view only
  product_types: VIEW,
  manufacturers: VIEW,
  manufacturer_countries: VIEW,
  doctor_categories: VIEW,
  doctor_sub_categories: VIEW,
  profiles: VIEW,
  // no Live Feed / Team Status / Attendance Status
  attendances: OFF,
};

async function run() {
  await connectDB();
  const role = await Role.findOne({ name: /^\s*representative\s*$/i });
  if (!role) { console.error("No Representative role"); await mongoose.disconnect(); process.exit(1); }

  Object.entries(CHANGES).forEach(([k, v]) => role.privileges.set(k, v));
  role.markModified("privileges");
  await role.save();

  console.log("Representative updated:");
  Object.keys(CHANGES).forEach((k) => {
    const v = role.privileges.get(k);
    const on = ["read", "add", "update", "delete"].filter((a) => v[a] === 1);
    console.log(`  - ${k.padEnd(24)} ${on.length ? on.join(", ") : "OFF"}`);
  });
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
