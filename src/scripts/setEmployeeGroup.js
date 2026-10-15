// Sets an employee's group by email.  node src/scripts/setEmployeeGroup.js <email> "<group name>"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import "../models/Section.js";

const [email, groupName] = process.argv.slice(2);
if (!email || !groupName) { console.error('Usage: node src/scripts/setEmployeeGroup.js <email> "<group name>"'); process.exit(1); }
await connectDB();
const emp = await Employee.findOne({ email: email.toLowerCase().trim() });
const esc = groupName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const group = await Group.findOne({ name: new RegExp(`^${esc}$`, "i") }).populate("section", "name");
if (!emp) console.error(`No employee with email ${email}`);
else if (!group) console.error(`No group named "${groupName}"`);
else {
  emp.group = group._id;
  await emp.save();
  await Group.updateOne({ _id: group._id }, { $addToSet: { members: emp._id } });
  console.log(`${emp.firstName} ${emp.lastName} -> group "${group.name}" (division ${group.section?.name || "NONE"})`);
}
await mongoose.disconnect();
