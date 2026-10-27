// Timesheet report: only the director(s), finance@cbs.ge (Tea) and admins.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const KEY = "timesheet_report";
const ON = { read: 1, add: 1, update: 1, delete: 1, import: 0, export: 1, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };

await connectDB();
const tea = await Employee.findOne({ email: "finance@cbs.ge" }).select("role").lean();
if (!tea) { console.error("❌ finance@cbs.ge not found"); process.exit(1); }
for (const r of await Role.find({})) {
  const allow = r.name.toLowerCase().trim() === "director" || String(r._id) === String(tea.role);
  const had = r.privileges.get(KEY)?.read === 1;
  if (!allow && !had) continue;
  r.privileges.set(KEY, allow ? ON : OFF);
  r.markModified("privileges");
  await r.save();
  const people = await Employee.find({ role: r._id, isActive: { $ne: false } }).select("firstName lastName email").lean();
  console.log(`${allow ? "✅ sees" : "🚫 removed"} — ${r.name}: ${people.map((p) => `${p.firstName} ${p.lastName}`.trim()).join(", ") || "—"}`);
}
console.log("Admins (incl. you) always see it.");
await mongoose.disconnect();
