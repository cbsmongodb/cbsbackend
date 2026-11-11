// Read-only: who does a person see on "Employee sales"?
// Usage: node src/scripts/checkSalesScope.js keti
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";
import EmployeeSale from "../models/EmployeeSale.js";
import { nameSearchFilter } from "../utils/nameSearch.js";
import { divisionEmployeeIds } from "../routes/employeeSales/employeeSales.controller.js";

async function run() {
  const q = process.argv.slice(2).join(" ");
  if (!q) throw new Error("ჩაწერე სახელი: node src/scripts/checkSalesScope.js keti");
  await connectDB();
  const people = await Employee.find(nameSearchFilter(q, ["firstName", "lastName"])).populate("role", "name");
  if (!people.length) console.log("ვერავინ მოიძებნა:", q);
  for (const me of people) {
    const group = me.group ? await Group.findById(me.group).select("name section").lean() : null;
    const sec = group?.section ? await Section.findById(group.section).select("name").lean() : null;
    const heads = await Section.find({ head: me._id }).select("name").lean();
    console.log(`\n=== ${me.firstName} ${me.lastName} | role: ${me.role?.name || "—"} | group: ${group?.name || "—"} | division: ${sec?.name || "—"}${heads.length ? " | head of: " + heads.map((h) => h.name).join(", ") : ""}`);
    const ids = await divisionEmployeeIds(me);
    if (!ids) { console.log("  ხედავს ყველას"); continue; }
    const list = await Employee.find({ _id: { $in: ids } }).select("firstName lastName").lean();
    const sales = await EmployeeSale.countDocuments({ employee: { $in: ids } });
    console.log(`  ხედავს ${list.length} თანამშრომელს, ${sales} გაყიდვას:`);
    list.forEach((e) => console.log("   -", e.firstName, e.lastName));
  }
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
