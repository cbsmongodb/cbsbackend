// Does a person now see all drugs of the division? (read-only)
//   node src/scripts/checkSharedDrugs.js n.basilidze@cbs.ge
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";
import "../models/Role.js";
import { getVisibleDrugIds } from "../utils/groupVisibility.js";

const email = (process.argv[2] || "n.basilidze@cbs.ge").toLowerCase();
await connectDB();
const sections = await Section.find({}).select("name sharedDrugs").lean();
console.log("\ndivisions:");
sections.forEach((s) => console.log(`  ${s.name}${s.sharedDrugs ? "  (shared drugs: ON)" : ""}`));
const e = await Employee.findOne({ email }).populate("role").lean();
if (!e) {
  console.log(`\nnot found: ${email}`);
} else {
  const g = await Group.findById(e.group).select("name drugs").lean();
  const v = await getVisibleDrugIds(e);
  console.log(`\n${e.firstName} ${e.lastName}`);
  console.log(`  own group ${g?.name || "-"}: ${(g?.drugs || []).length} drugs`);
  console.log(`  now sees: ${v.length} drugs`);
}
await mongoose.disconnect();
