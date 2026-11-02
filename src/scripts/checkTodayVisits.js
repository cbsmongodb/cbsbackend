// Today's visits + check-ins (read-only)
// node src/scripts/checkTodayVisits.js "a@cbs.ge,b@cbs.ge"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Plan from "../models/PlanConfiguration.js";
import Attendance from "../models/Attendance.js";
import "../models/Hospital.js";
import "../models/Pharmacy.js";

const emails = (process.argv[2] || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
if (!emails.length) {
  console.error("Usage: node ... \"email1,email2\"");
  process.exit(1);
}
const H = 3600 * 1000;
const t = (d) =>
  new Date(d).toLocaleString("en-GB", {
    timeZone: "Asia/Tbilisi",
  });

await connectDB();
const tb = new Date(Date.now() + 4 * H);
const y = tb.getUTCFullYear();
const m = tb.getUTCMonth();
const d = tb.getUTCDate();
const dayStart = new Date(Date.UTC(y, m, d) - 4 * H);
const weekAgo = new Date(+dayStart - 7 * 24 * H);

for (const email of emails) {
  const e = await Employee.findOne({ email })
    .select("firstName lastName")
    .lean();
  if (!e) {
    console.log("\n? " + email + ": not found");
    continue;
  }
  console.log("\n>> " + e.firstName + " " + e.lastName);

  const plans = await Plan.find({
    performer: e._id,
    $or: [
      { period: { $gte: weekAgo } },
      { updatedAt: { $gte: dayStart } },
    ],
  })
    .select("period status updatedAt hospital pharmacy")
    .populate("hospital", "name")
    .populate("pharmacy", "pharmacyName")
    .sort({ period: 1 })
    .lean();
  const recent = plans.filter(
    (p) => p.period >= dayStart || p.updatedAt >= dayStart
  );
  if (!recent.length) console.log("   no visits for today");
  for (const p of recent) {
    const place =
      p.hospital?.name || p.pharmacy?.pharmacyName || "-";
    console.log("   VISIT date " + t(p.period));
    console.log("     status: " + p.status + " | " + place);
    console.log("     last change " + t(p.updatedAt));
  }

  const att = await Attendance.find({
    employee: e._id,
    attendanceTime: { $gte: dayStart },
  })
    .select("attendanceType attendanceTime viaPlan")
    .lean();
  if (!att.length) console.log("   no check-ins today");
  for (const a of att) {
    const kind = a.viaPlan ? "(visit)" : "(office)";
    console.log(
      "   CHECK " + a.attendanceType + " " +
        t(a.attendanceTime) + " " + kind
    );
  }
}
await mongoose.disconnect();
