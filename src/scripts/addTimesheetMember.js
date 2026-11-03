// Adds a person to a timesheet (linked to the CRM employee, so leaves show).
//   node src/scripts/addTimesheetMember.js div2-region t.natchkebia@cbs.ge "თამარ ნაჭყებია" "სამ. წარმომადგენელი" [პირადი_ნომერი] [--apply]
// Sheets: div1-tbilisi div1-region div2-tbilisi div2-region div3-tbilisi div3-region office warehouse
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import TimesheetSheet from "../models/TimesheetSheet.js";
import TimesheetMember from "../models/TimesheetMember.js";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
// --unlink-other: the account is wrongly linked to ANOTHER row -> that row
// stays on the timesheet but without this CRM account
const UNLINK = process.argv.includes("--unlink-other");
const [sheetKey, email, nameKa, position, personalId = ""] = args;
if (!sheetKey || !email || !nameKa) {
  console.error('Usage: node src/scripts/addTimesheetMember.js <sheet> <email> "სახელი გვარი" "თანამდებობა" [პირადი_ნომერი] [--apply]');
  process.exit(1);
}

await connectDB();
const sheet = await TimesheetSheet.findOne({ key: sheetKey }).lean();
const emp = await Employee.findOne({ email: email.toLowerCase().trim() }).select("firstName lastName").lean();
const stop = async (msg) => { console.log(msg); await mongoose.disconnect(); process.exit(0); };
if (!sheet) await stop(`ტაბელი ვერ მოიძებნა: ${sheetKey}`);
if (!emp) await stop(`თანამშრომელი ვერ მოიძებნა: ${email}`);
const already = await TimesheetMember.find({ employee: emp._id }).lean();
if (already.length) {
  already.forEach((r) => console.log(`უკვე არის ტაბელში: ${r.sheet} - ${r.nameKa}${r.leftAfter ? ` (წასული ${r.leftAfter})` : ""}`));
  if (!UNLINK) await stop("არაფერი შეიცვალა (თუ ეს ხაზი სხვა ადამიანია, დაამატე --unlink-other)");
  console.log(`   -> ამ ხაზს ${emp.firstName} ${emp.lastName}-ის ანგარიში მოეხსნება (ხაზი ტაბელში რჩება)`);
  if (APPLY) await TimesheetMember.updateMany({ employee: emp._id }, { $set: { employee: null } });
}
const last = await TimesheetMember.findOne({ sheet: sheet.key }).sort({ order: -1 }).select("order").lean();
console.log(`${sheet.title}: + ${nameKa} (${emp.firstName} ${emp.lastName}) - ${position || ""} ${personalId}`);
if (APPLY) {
  await TimesheetMember.create({
    sheet: sheet.key,
    employee: emp._id,
    nameKa: nameKa.trim(),
    personalId: personalId.trim(),
    position: (position || "").trim(),
    hours: 8,
    workDays: [1, 2, 3, 4, 5],
    order: (last?.order || 0) + 1,
  });
  console.log("\n✅ დაემატა - ტაბელი განაახლე");
} else {
  console.log("\n(შემოწმება - ჩასაწერად დაამატე --apply)");
}
await mongoose.disconnect();
