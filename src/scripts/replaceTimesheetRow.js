// Puts another person into an existing timesheet row (same place, same position).
//   node src/scripts/replaceTimesheetRow.js office "ლიკა ქავთარაძე" "ლიზი ბოგვერაძე" 01005026386 lbogveradze12@gmail.com          (check)
//   ... --apply   (write)
// The new person is linked to her CRM account (by email) so her leaves show.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import TimesheetMember from "../models/TimesheetMember.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const [sheet, oldName, newName, personalId = "", email = ""] = args;
if (!sheet || !oldName || !newName) {
  console.error('Usage: node src/scripts/replaceTimesheetRow.js <sheet> "ძველი სახელი" "ახალი სახელი" [პირადი] [email] [--apply]');
  process.exit(1);
}
const stop = async (msg) => { console.log(msg); await mongoose.disconnect(); process.exit(0); };

await connectDB();
const rows = await TimesheetMember.find({ sheet, nameKa: { $regex: `^\\s*${oldName.trim()}` } }).lean();
if (rows.length !== 1) await stop(rows.length ? "რამდენიმე ხაზი მოიძებნა" : `${sheet}: "${oldName}" ვერ მოიძებნა`);
const row = rows[0];
let emp = null;
if (email) {
  emp = await Employee.findOne({ email: email.toLowerCase().trim() }).select("firstName lastName").lean();
  if (!emp) await stop(`სისტემაში ვერ მოიძებნა: ${email}`);
  const other = await TimesheetMember.findOne({ employee: emp._id, _id: { $ne: row._id } }).lean();
  if (other) await stop(`${emp.firstName} ${emp.lastName} უკვე არის ტაბელში: ${other.sheet} - ${other.nameKa}`);
}
console.log(`${sheet} #${row.order}: ${row.nameKa} (${row.personalId}) - ${row.position}`);
console.log(`   -> ${newName} (${personalId || row.personalId})${emp ? `, CRM: ${emp.firstName} ${emp.lastName}` : ""}`);
if (APPLY) {
  const set = { nameKa: newName.trim(), employee: emp ? emp._id : null };
  if (personalId) set.personalId = personalId.trim();
  await TimesheetMember.updateOne({ _id: row._id }, { $set: set });
  console.log("\n✅ შეიცვალა - ტაბელი განაახლე");
} else {
  console.log("\n(შემოწმება - ჩასაწერად დაამატე --apply)");
}
await mongoose.disconnect();
