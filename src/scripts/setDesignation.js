// Shows an employee's role + designation and sets the designation.
//   node src/scripts/setDesignation.js "Rumisa"              (only show)
//   node src/scripts/setDesignation.js "Rumisa" "Director"   (set)
// The first argument matches first name, last name or email.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Designation from "../models/Designation.js";
import "../models/Role.js";

const [who, position] = process.argv.slice(2);
if (!who) { console.error('Usage: node src/scripts/setDesignation.js "name or email" ["Position"]'); process.exit(1); }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function run() {
  await connectDB();
  const rx = new RegExp(esc(who.trim()), "i");
  const found = await Employee.find({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] })
    .populate("role", "name").populate("designation", "position");
  if (found.length !== 1) {
    console.log(found.length ? `More than one match for "${who}":` : `No employee matches "${who}"`);
    found.forEach((e) => console.log(`  - ${e.firstName} ${e.lastName} (${e.email})`));
    await mongoose.disconnect();
    process.exit(found.length ? 1 : 1);
  }
  const emp = found[0];
  console.log(`${emp.firstName} ${emp.lastName} (${emp.email})`);
  console.log(`  role:        ${emp.role?.name || "none"}`);
  console.log(`  designation: ${JSON.stringify(emp.designation?.position ?? null)}`);

  if (position) {
    let des = await Designation.findOne({ position: new RegExp(`^\\s*${esc(position.trim())}\\s*$`, "i") });
    if (!des) {
      des = await Designation.create({ position: position.trim() });
      console.log(`  (created designation "${des.position}")`);
    }
    if (des.position !== position.trim()) {
      console.log(`  ! existing designation is spelled ${JSON.stringify(des.position)} — the sidebar label needs exactly "${position.trim()}"`);
    }
    await Employee.updateOne({ _id: emp._id }, { $set: { designation: des._id } });
    console.log(`  -> designation set to ${JSON.stringify(des.position)}`);
  }
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
