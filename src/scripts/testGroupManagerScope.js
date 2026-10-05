import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Role from "../models/Role.js";
import { getVisibleEmployeeIds } from "../utils/groupVisibility.js";

async function run() {
  await connectDB();
  // change the email to the group manager you want to test
  const email = "cici.merabishvili@mail.ru";
  const mgr = await Employee.findOne({ email }).populate("role");
  if (!mgr) { console.error("not found:", email); await mongoose.disconnect(); return; }
  console.log("Manager:", mgr.firstName, mgr.lastName, "| role:", mgr.role?.name);
  const ids = await getVisibleEmployeeIds(mgr);
  const people = await Employee.find({ _id: { $in: ids } }).select("firstName lastName");
  console.log("Sees " + people.length + " people:");
  people.forEach(p => console.log("  -", p.firstName, p.lastName));
  await mongoose.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
