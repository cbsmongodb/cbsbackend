// Shows the last check-ins/outs of one employee and the last 7 days for everyone.
//   node src/scripts/checkAttendance.js you@cbs.ge
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Attendance from "../models/Attendance.js";
import Employee from "../models/Employee.js";

const email = (process.argv[2] || "").toLowerCase().trim();
await connectDB();
const fmt = (d) => new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Tbilisi" });
if (email) {
  const e = await Employee.findOne({ email });
  if (!e) console.log(`No employee with email ${email}`);
  else {
    const rows = await Attendance.find({ employee: e._id }).sort({ attendanceTime: -1 }).limit(15);
    console.log(`\n${e.firstName} ${e.lastName}: ${await Attendance.countDocuments({ employee: e._id })} records in total, latest:`);
    for (const r of rows) console.log(`  ${fmt(r.attendanceTime)}  ${r.attendanceType.padEnd(8)} ${r.attendanceStatus}${r.viaPlan ? "  (from a visit)" : ""}`);
  }
}
const since = new Date(Date.now() - 7 * 86400000);
const recent = await Attendance.find({ attendanceTime: { $gte: since } }).populate("employee", "firstName lastName").sort({ attendanceTime: -1 }).limit(20);
console.log(`\nLast 7 days, everyone: ${await Attendance.countDocuments({ attendanceTime: { $gte: since } })} records. Newest 20:`);
for (const r of recent) console.log(`  ${fmt(r.attendanceTime)}  ${r.attendanceType.padEnd(8)} ${r.employee ? r.employee.firstName + " " + r.employee.lastName : "?"}`);
await mongoose.disconnect();
