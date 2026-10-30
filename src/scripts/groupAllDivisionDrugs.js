// Give one group every drug of its division (union of the drugs of all groups
// in the same division). Drugs the group already has stay.
//   node src/scripts/groupAllDivisionDrugs.js "P - REGIONS"            (check only)
//   node src/scripts/groupAllDivisionDrugs.js "P - REGIONS" --apply    (write)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";
import Drug from "../models/Drug.js";

const name = process.argv.slice(2).find((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!name) { console.log('Usage: node src/scripts/groupAllDivisionDrugs.js "<group name>" [--apply]'); process.exit(1); }
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9ა-ჰ]/g, "");

await connectDB();
const all = await Group.find({}).select("name section drugs").lean();
const target = all.filter((g) => norm(g.name) === norm(name));
if (target.length !== 1) {
  console.log(target.length ? "⚠️  რამდენიმე ჯგუფი ემთხვევა:" : `❌ ჯგუფი "${name}" ვერ ვიპოვე. ჯგუფები:`);
  (target.length ? target : all).forEach((g) => console.log(`   ${g.name}`));
  await mongoose.disconnect(); process.exit(0);
}
const g = target[0];
if (!g.section) { console.log(`❌ "${g.name}" დივიზიონზე არ არის მიბმული`); await mongoose.disconnect(); process.exit(0); }
const section = await Section.findById(g.section).select("name groups").lean();
const ids = new Set((section.groups || []).map(String));
all.filter((x) => String(x.section) === String(g.section)).forEach((x) => ids.add(String(x._id)));
const divisionGroups = all.filter((x) => ids.has(String(x._id)));
const have = new Set((g.drugs || []).map(String));
const union = new Set();
divisionGroups.forEach((x) => (x.drugs || []).forEach((d) => union.add(String(d))));
const add = [...union].filter((d) => !have.has(d));
const drugs = await Drug.find({ _id: { $in: add } }).select("name isActive").sort({ name: 1 }).lean();

console.log(`\nჯგუფი: ${g.name}   დივიზიონი: ${section.name}`);
console.log(`დივიზიონის ჯგუფები: ${divisionGroups.map((x) => `${x.name} (${(x.drugs || []).length})`).join(", ")}`);
console.log(`ახლა აქვს: ${have.size} წამალი, დივიზიონში სულ: ${union.size}`);
console.log(`დაემატება: ${drugs.length}`);
drugs.forEach((d) => console.log(`   + ${d.name}${d.isActive ? "" : "  (არააქტიური — ექიმის ჩანაწერში არ გამოჩნდება)"}`));
if (!APPLY) console.log("\nCHECK ONLY — ჩასაწერად დაამატე --apply");
else if (drugs.length) {
  await Group.updateOne({ _id: g._id }, { $addToSet: { drugs: { $each: drugs.map((d) => d._id) } } });
  console.log(`\n✅ ${g.name}-ს დაემატა ${drugs.length} წამალი`);
}
await mongoose.disconnect();
