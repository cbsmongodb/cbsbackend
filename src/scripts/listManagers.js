// Managers with e-mail, their group, and how many people's sales each one sees (read only)
//   node src/scripts/listManagers.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Role from "../models/Role.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";
import { divisionEmployeeIds } from "../routes/employeeSales/employeeSales.controller.js";

await connectDB();
const roles = await Role.find({ name: /group manager|division manager|product manager/i }).select("_id name").lean();
const people = await Employee.find({ role: { $in: roles.map((r) => r._id) }, isActive: { $ne: false } })
  .populate("role", "name").populate({ path: "group", select: "name section", populate: { path: "section", select: "name" } })
  .select("firstName lastName email role group").lean();
people.sort((a, b) => String(a.group?.section?.name || "").localeCompare(String(b.group?.section?.name || "")) || String(a.group?.name || "").localeCompare(String(b.group?.name || "")));
for (const p of people) {
  const ids = await divisionEmployeeIds(p);
  console.log(`${p.group?.section?.name || "-"} / ${p.group?.name || "-"} | ${p.role?.name} | ${p.firstName} ${p.lastName} | ${p.email} | sees ${ids ? ids.length : "ALL"}`);
}
console.log("total:", people.length);
await mongoose.disconnect();
