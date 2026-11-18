// Which section(s) does this person head? With --apply the head is cleared.
//   node src/scripts/clearSectionHead.js someone@mail.com
//   node src/scripts/clearSectionHead.js someone@mail.com --apply
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Section from "../models/Section.js";
import Group from "../models/Group.js";

const email = (process.argv[2] || "").toLowerCase();
const APPLY = process.argv.includes("--apply");
await connectDB();
const emp = await Employee.findOne({ email }).select("firstName lastName isActive").lean();
if (!emp) { console.log("not found:", email); process.exit(1); }
console.log(`${emp.firstName} ${emp.lastName} active=${emp.isActive}`);
const sections = await Section.find({ head: emp._id }).select("name groups").lean();
const groups = await Group.find({ head: emp._id }).select("name").lean();
sections.forEach((s) => console.log(`  heads section: ${s.name} (${(s.groups || []).length} groups)`));
groups.forEach((g) => console.log(`  heads group: ${g.name}`));
if (!sections.length && !groups.length) console.log("  heads nothing");
if (APPLY) {
  const a = await Section.updateMany({ head: emp._id }, { $set: { head: null } });
  const b = await Group.updateMany({ head: emp._id }, { $set: { head: null } });
  console.log(`cleared: sections ${a.modifiedCount}, groups ${b.modifiedCount}`);
} else console.log("preview only - add --apply to clear");
await mongoose.disconnect();
