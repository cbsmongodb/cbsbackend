// Product Manager (agreed Oct 2026): sees their own DIVISION (the division of
// their group). Product configuration: view. Market configuration: doctors and
// hospitals add + edit, the rest view. Attendance report (division), legacy
// Prescriptions (view) and the new Prescriptions report. No Live Feed.
// Only the keys below are touched. Safe to re-run.
//   node src/scripts/setProductManagerRole.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";
import "../models/Group.js";
import "../models/Section.js";

const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const VIEW = { ...OFF, read: 1 };
const EDIT = { ...OFF, read: 1, add: 1, update: 1 };

const ACCESS = {
  drugs: VIEW, product_types: VIEW, manufacturers: VIEW, manufacturer_countries: VIEW,
  doctors: EDIT, hospitals: EDIT,
  doctor_categories: VIEW, doctor_sub_categories: VIEW, pharmacies: VIEW, profiles: VIEW,
  attendance_report: VIEW, attendances: OFF,
  prescriptions: VIEW, prescriptions_report: VIEW,
  plannings: { ...EDIT, delete: 1 }, // own plannings only (planning.controller.js)
};

async function run() {
  await connectDB();
  const role = await Role.findOne({ name: /^\s*product\s+manager\s*$/i });
  if (!role) { console.error("No Product Manager role"); await mongoose.disconnect(); process.exit(1); }
  Object.entries(ACCESS).forEach(([k, v]) => role.privileges.set(k, v));
  role.markModified("privileges");
  await role.save();
  console.log("Product Manager updated.");

  const people = await Employee.find({ role: role._id })
    .select("firstName lastName isActive group")
    .populate({ path: "group", select: "name section", populate: { path: "section", select: "name" } });
  people.forEach((p) => {
    const division = p.group?.section?.name;
    console.log(`  - ${p.firstName} ${p.lastName}: group ${p.group?.name || "NONE"}, division ${division || "NONE"}` +
      (division ? "" : "   <-- no division: will only see themselves") +
      (p.isActive ? "" : "   <-- INACTIVE"));
  });
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
