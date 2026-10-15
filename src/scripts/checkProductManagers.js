// Shows, for every Product Manager, which division / groups / drugs / people they see.
//   node src/scripts/checkProductManagers.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Drug from "../models/Drug.js";
import "../models/Section.js";
import { getVisibleGroups, getVisibleDrugIds, getScopeEmployeeIds } from "../utils/groupVisibility.js";

async function run() {
  await connectDB();
  const role = await Role.findOne({ name: /^\s*product\s+manager\s*$/i });
  if (!role) { console.log("No Product Manager role"); return mongoose.disconnect(); }
  const people = await Employee.find({ role: role._id }).populate("role")
    .populate({ path: "group", select: "name section drugs", populate: { path: "section", select: "name" } });
  console.log(`Drugs in DB: ${await Drug.countDocuments()}`);
  for (const p of people) {
    console.log(`\n=== ${p.firstName} ${p.lastName} (${p.email}) ${p.isActive ? "" : "[INACTIVE]"}`);
    console.log(`  own group: ${p.group?.name || "NONE"} | division: ${p.group?.section?.name || "NONE"}`);
    const groups = await getVisibleGroups(p);
    console.log(`  visible groups (${groups.length}):`);
    for (const g of groups) console.log(`    - ${g.name}: ${(g.drugs || []).length} drugs`);
    console.log(`  => drugs visible: ${(await getVisibleDrugIds(p)).length}`);
    const ids = await getScopeEmployeeIds(p);
    console.log(`  => people visible (Field Team Status, Live Feed): ${ids ? ids.length : "ALL"}`);
  }
  await mongoose.disconnect();
}
run().catch((e) => { console.error(e); process.exit(1); });
