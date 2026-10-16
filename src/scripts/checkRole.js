// Shows, for every employee of a role, which division / groups / drugs / people they see.
//   node src/scripts/checkRole.js "Division Manager"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";
import Section from "../models/Section.js";
import "../models/Group.js";
import { getVisibleGroups, getVisibleDrugIds, getScopeEmployeeIds } from "../utils/groupVisibility.js";

const roleName = process.argv[2];
if (!roleName) { console.error('Usage: node src/scripts/checkRole.js "<role name>"'); process.exit(1); }
await connectDB();
const esc = roleName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
const role = await Role.findOne({ name: new RegExp(`^\\s*${esc}\\s*$`, "i") });
if (!role) {
  console.log(`No role "${roleName}". Roles: ${(await Role.find().distinct("name")).join(", ")}`);
} else {
  const people = await Employee.find({ role: role._id }).populate("role")
    .populate({ path: "group", select: "name section", populate: { path: "section", select: "name" } });
  console.log(`${role.name}: ${people.length} people`);
  for (const p of people) {
    const headOf = await Section.findOne({ head: p._id }).select("name");
    console.log(`\n=== ${p.firstName} ${p.lastName} (${p.email}) ${p.isActive ? "" : "[INACTIVE]"}`);
    console.log(`  head of division: ${headOf?.name || "no"} | own group: ${p.group?.name || "NONE"} | group's division: ${p.group?.section?.name || "NONE"}`);
    const groups = await getVisibleGroups(p);
    console.log(`  visible groups (${groups.length}): ${groups.map((g) => g.name).join(", ") || "-"}`);
    console.log(`  => drugs visible: ${(await getVisibleDrugIds(p)).length}`);
    const ids = await getScopeEmployeeIds(p);
    console.log(`  => people visible: ${ids ? ids.length : "ALL"}`);
  }
}
await mongoose.disconnect();
