// What does someone see on the Groups page? (read-only)
//   node src/scripts/checkGroupsVisible.js "Nana Berianidze"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";
import "../models/Role.js";
import { getVisibleGroups, getDivisionGroups } from "../utils/groupVisibility.js";

const who = (process.argv[2] || "").trim();
if (!who) {
  console.error('Usage: node ... "Name Surname" or "email"');
  process.exit(1);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

await connectDB();
let q;
if (who.includes("@")) q = { email: who.toLowerCase() };
else {
  const [f, ...l] = who.split(/\s+/);
  q = {
    firstName: new RegExp(`^${esc(f)}$`, "i"),
    lastName: new RegExp(`^${esc(l.join(" "))}$`, "i"),
  };
}
const e = await Employee.findOne(q).populate("role").lean();
if (!e) {
  console.log("not found:", who);
  await mongoose.disconnect();
  process.exit(0);
}
const own = e.group ? await Group.findById(e.group).select("name section").lean() : null;
const sec = own?.section ? await Section.findById(own.section).select("name").lean() : null;
const heads = await Group.find({ head: e._id }).select("name").lean();
console.log(`\n${e.firstName} ${e.lastName}`);
console.log("  role:        " + (e.role?.name || "-"));
console.log("  own group:   " + (own?.name || "-") + "  (division: " + (sec?.name || "NONE") + ")");
console.log("  head of:     " + (heads.map((g) => g.name).join(", ") || "-"));
const vis = await getVisibleGroups(e);
console.log("  people from: " + (vis.map((g) => g.name).join(", ") || "-"));
const div = await getDivisionGroups(e);
console.log("  Groups page: " + (div.map((g) => g.name).join(", ") || "-"));
await mongoose.disconnect();
