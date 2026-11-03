// Turn "everyone sees all drugs of the division" on / off for a division.
//   node src/scripts/setSharedDrugs.js                      (list divisions)
//   node src/scripts/setSharedDrugs.js "3 DIVIZION" on       (check)
//   node src/scripts/setSharedDrugs.js "3 DIVIZION" on --apply
//   node src/scripts/setSharedDrugs.js "3 DIVIZION" off --apply
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Section from "../models/Section.js";
import Group from "../models/Group.js";
import Employee from "../models/Employee.js";

const [name, onoff] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");

await connectDB();
const sections = await Section.find({}).select("name sharedDrugs groups").lean();
if (!name) {
  sections.forEach((x) => console.log(`- ${x.name}${x.sharedDrugs ? "   (shared drugs: ON)" : ""}`));
  await mongoose.disconnect();
  process.exit(0);
}
const sec = sections.find((x) => x.name.toLowerCase().trim() === name.toLowerCase().trim());
if (!sec) {
  console.log(`not found: ${name}`);
  sections.forEach((x) => console.log(`- ${x.name}`));
  await mongoose.disconnect();
  process.exit(0);
}
const groups = await Group.find({ $or: [{ section: sec._id }, { _id: { $in: sec.groups || [] } }] })
  .select("name drugs").lean();
const drugs = new Set(groups.flatMap((x) => (x.drugs || []).map(String)));
const people = await Employee.countDocuments({ group: { $in: groups.map((x) => x._id) }, isActive: true });
const on = onoff !== "off";
console.log(`\n${sec.name}: ${groups.length} groups, ${drugs.size} drugs, ${people} active people`);
groups.forEach((x) => console.log(`   ${x.name}: ${(x.drugs || []).length} drugs`));
console.log(`\n-> shared drugs ${on ? "ON: everyone sees all " + drugs.size + " drugs" : "OFF: everyone sees only their group's drugs"}`);
if (APPLY) {
  await Section.updateOne({ _id: sec._id }, { $set: { sharedDrugs: on } });
  console.log("\n✅ saved - people should refresh the page (takes up to 1 minute)");
} else {
  console.log("\n(check only - add --apply)");
}
await mongoose.disconnect();
