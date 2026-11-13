// Who would this user see on the Employee Sales page? (read only)
//   node src/scripts/whoSeesSales.js someone@cbs.ge
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import "../models/Role.js";
import { divisionEmployeeIds } from "../routes/employeeSales/employeeSales.controller.js";
import { seesEverything } from "../utils/groupVisibility.js";

const email = (process.argv[2] || "").toLowerCase();
await connectDB();
const me = await Employee.findOne({ email }).populate("role").lean();
if (!me) { console.log("not found:", email); process.exit(1); }
console.log(`${me.firstName} ${me.lastName} | role: ${me.role?.name} | sees everything: ${seesEverything(me)}`);
const ids = await divisionEmployeeIds(me);
if (!ids) {
  console.log("-> NO FILTER: this role sees ALL employees' sales");
} else {
  const people = await Employee.find({ _id: { $in: ids } }).select("firstName lastName").sort({ firstName: 1 }).lean();
  console.log(`-> sees ${people.length} people:`);
  console.log(people.map((p) => `${p.firstName} ${p.lastName}`).join(", "));
}
await mongoose.disconnect();
