import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import LeaveEntry from "../models/LeaveEntry.js";
import Employee from "../models/Employee.js";
const email = (process.argv[2] || "").toLowerCase();
const k = (d) => new Date(+new Date(d) + 12 * 3600e3).toISOString().slice(0, 10);
await connectDB();
const emp = await Employee.findOne({ email }).select("firstName lastName").lean();
if (!emp) { console.log("not found:", email); process.exit(1); }
const rows = await LeaveEntry.find({ employee: emp._id }).sort({ startDate: 1 }).lean();
console.log(emp.firstName, emp.lastName, "-", rows.length, "entries (READ ONLY)");
for (const r of rows) {
  const days = r.days?.length ? r.days.map((d) => k(d.date)).join(",") : "";
  console.log(String(r._id), r.type, r.status || "approved", k(r.startDate), "->", k(r.endDate), "days:", r.daysCount, "added:", k(r.createdAt), days.length > 70 ? days.slice(0, 70) + "..." : days);
}
await mongoose.disconnect();
