import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import LeaveEntry from "../models/LeaveEntry.js";
import Employee from "../models/Employee.js";
const [id, email, from, to] = process.argv.slice(2);
const k = (d) => new Date(+new Date(d) + 12 * 3600e3).toISOString().slice(0, 10);
await connectDB();
const emp = await Employee.findOne({ email: String(email).toLowerCase() }).select("_id firstName lastName").lean();
const row = await LeaveEntry.findById(id).lean();
if (!emp || !row) { console.log("NOT FOUND - nothing deleted"); process.exit(1); }
if (String(row.employee) !== String(emp._id) || k(row.startDate) !== from || k(row.endDate) !== to) {
  console.log("DOES NOT MATCH (person or dates) - nothing deleted"); process.exit(1);
}
await LeaveEntry.deleteOne({ _id: row._id });
console.log("deleted:", emp.firstName, emp.lastName, from, "->", to, "(" + row.daysCount + " days)");
await mongoose.disconnect();
