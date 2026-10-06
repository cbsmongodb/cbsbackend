// Read-only: today's check-ins / check-outs of one employee and whether the
// Live Feed / Attendance Status page would count them.
//   node src/scripts/checkTodayAttendance.js "Zohra"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Attendance from "../models/Attendance.js";
import Address from "../models/Address.js";

const who = process.argv[2];
if (!who) { console.error('Usage: node src/scripts/checkTodayAttendance.js "name or email"'); process.exit(1); }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function run() {
  await connectDB();
  const rx = new RegExp(esc(who.trim()), "i");
  const emp = await Employee.findOne({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }] });
  if (!emp) { console.log("No employee matches", who); await mongoose.disconnect(); return; }
  console.log(`${emp.firstName} ${emp.lastName}  active: ${emp.isActive}  workDays: ${JSON.stringify(emp.workDays)}`);

  const since = new Date(Date.now() - 36 * 3600 * 1000);
  const serverStartOfDay = new Date(); serverStartOfDay.setHours(0, 0, 0, 0);
  console.log(`server time now: ${new Date().toISOString()}   live feed counts from: ${serverStartOfDay.toISOString()}`);

  const loc = await Address.findOne({ addressableType: "Employee", addressableId: emp._id, addressType: "current_location" });
  console.log(`current location: ${loc ? `${loc.lat}, ${loc.lng} (updated ${loc.updatedAt?.toISOString?.()})` : "NONE"}`);

  const atts = await Attendance.find({ employee: emp._id, attendanceTime: { $gte: since } }).sort({ attendanceTime: 1 });
  if (!atts.length) console.log("\nNO check-in/check-out records in the last 36 hours  <-- the check-in never reached the server");
  for (const a of atts) {
    const addr = await Address.findOne({ addressableType: "Attendance", addressableId: a._id });
    const reasons = [];
    if (a.viaPlan) reasons.push("viaPlan is set");
    if (a.attendanceTime < serverStartOfDay) reasons.push("before server's start of day");
    if (!addr) reasons.push("no address record");
    else if (addr.lat == null || addr.lng == null) reasons.push("address has no coordinates");
    console.log(`\n${a.attendanceType.padEnd(9)} ${a.attendanceTime.toISOString()}  status: ${a.attendanceStatus}`);
    console.log(`  location: ${addr ? `${addr.lat}, ${addr.lng}` : "none"}`);
    console.log(`  shown in Live Feed / Attendance Status: ${reasons.length ? "NO  <-- " + reasons.join(", ") : "yes"}`);
  }
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
