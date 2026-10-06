// Accountant's assistant (agreed Oct 2026) + split "attendance report" from
// Live Feed. Safe to re-run.
//   node src/scripts/setAccountantRole.js
//
// 1) New key "attendance_report" (Reports -> Attendance report). Until now that
//    page shared the "attendances" key with Live Feed / Team Status, so giving
//    the report meant giving Live Feed too. Every role that can read
//    "attendances" today gets "attendance_report" read, so nobody loses it.
// 2) Accountant's assistant: drugs + product config and doctors + hospitals
//    fully; attendance report only (no Live Feed); administration lists
//    (employees, designations, sections, groups, regions) add + edit.
//    stock_upload is left as it is.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";

const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const VIEW = { ...OFF, read: 1 };
const EDIT = { ...OFF, read: 1, add: 1, update: 1 };
const FULL = { ...OFF, read: 1, add: 1, update: 1, delete: 1, import: 1, export: 1 };

const ACCOUNTANT = {
  drugs: FULL,
  product_types: FULL,
  manufacturers: FULL,
  manufacturer_countries: FULL,
  doctors: FULL,
  hospitals: FULL,
  attendances: OFF,          // no Live Feed / Team Status / Attendance Status
  attendance_report: VIEW,   // Reports -> Attendance report
  employees: EDIT,
  designations: EDIT,
  sections: EDIT,
  groups: EDIT,
  regions: EDIT,
};

const get = (privs, k) => (privs instanceof Map ? privs.get(k) : privs?.[k]);

async function run() {
  await connectDB();

  // 1) migrate attendance_report
  const roles = await Role.find({});
  let migrated = 0;
  for (const r of roles) {
    if (!r.privileges) continue;
    const att = get(r.privileges, "attendances");
    const rep = get(r.privileges, "attendance_report");
    if (att && att.read === 1 && !(rep && rep.read === 1)) {
      r.privileges.set("attendance_report", VIEW);
      r.markModified("privileges");
      await r.save();
      migrated++;
      console.log(`  attendance_report copied to: ${r.name}`);
    }
  }
  console.log(`attendance_report: ${migrated} role(s) migrated\n`);

  // 2) Accountant's assistant
  const acc = await Role.findOne({ name: /^\s*accountant.?s\s+assistant\s*$/i });
  if (!acc) { console.error("Accountant's assistant role not found"); await mongoose.disconnect(); process.exit(1); }
  Object.entries(ACCOUNTANT).forEach(([k, v]) => acc.privileges.set(k, v));
  acc.markModified("privileges");
  await acc.save();

  console.log(`${acc.name} — pages with access:`);
  const rows = [];
  acc.privileges.forEach((v, k) => {
    const on = ["read", "add", "update", "delete", "import"].filter((a) => v && v[a] === 1);
    if (on.length) rows.push(`  - ${k.padEnd(24)} ${on.join(", ")}`);
  });
  rows.sort().forEach((l) => console.log(l));
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
