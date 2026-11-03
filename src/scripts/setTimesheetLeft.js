// Someone left: stays on the timesheet up to the last working day, gone after.
//   node src/scripts/setTimesheetLeft.js "ხათუნა ბიჭიაშვილი" 2026-10-31          (check)
//   node src/scripts/setTimesheetLeft.js "ხათუნა ბიჭიაშვილი" 2026-10-31 --apply  (write)
//   ... "ხათუნა ბიჭიაშვილი" back --apply   -> back on the timesheet
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import TimesheetMember from "../models/TimesheetMember.js";

const [nameRaw, day] = process.argv.slice(2);
const APPLY = process.argv.includes("--apply");
const back = day === "back";
if (!nameRaw || (!back && !/^\d{4}-\d{2}-\d{2}$/.test(String(day)))) {
  console.error('Usage: node src/scripts/setTimesheetLeft.js "სახელი გვარი" 2026-10-31 [--apply]');
  process.exit(1);
}
const name = nameRaw.trim();

await connectDB();
const rows = await TimesheetMember.find({ nameKa: { $regex: `^\\s*${name}` } }).lean();
if (!rows.length) console.log(`ტაბელში ვერ მოიძებნა: ${name}`);
for (const r of rows) {
  const what = back ? "ბრუნდება ტაბელში" : `ბოლო სამუშაო დღე ${day} - შემდეგი თვეებიდან ქრება`;
  console.log(`${r.sheet}: ${r.nameKa} -> ${what}`);
  if (APPLY) {
    await TimesheetMember.updateOne({ _id: r._id }, { $set: { leftAfter: back ? "" : day } });
  }
}
console.log(APPLY ? "\n✅ ჩაიწერა - ტაბელი განაახლე" : "\n(შემოწმება - ჩასაწერად დაამატე --apply)");
await mongoose.disconnect();
