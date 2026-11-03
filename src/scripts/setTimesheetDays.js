// Writes a code into timesheet cells by hand - for people who have no CRM
// account (their leaves can't come in automatically).
//   node src/scripts/setTimesheetDays.js "ბორის ზიბზიბაძე" 2026-10-01 2026-10-04 "ა/შ"          (check)
//   node src/scripts/setTimesheetDays.js "ბორის ზიბზიბაძე" 2026-10-01 2026-10-04 "ა/შ" --apply  (write)
// Codes: ა/შ (paid leave), ს/ფ (sick), უხ/შ (unpaid), დ, გ, დ/შ, or hours (8).
// Every day in the range is set, weekends too. Code "auto" = back to automatic.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import TimesheetMember from "../models/TimesheetMember.js";
import TimesheetCell from "../models/TimesheetCell.js";

const [nameKa, fromS, toS, code] = process.argv.slice(2);
const APPLY = process.argv.includes("--apply");
const CODES = ["დ", "ა/შ", "უხ/შ", "ს/ფ", "გ", "დ/შ", "auto"];
const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));
const okCode = CODES.includes(code) || /^\d{1,2}(\.\d{1,2})?$/.test(String(code));
if (!nameKa || !okDate(fromS) || !okDate(toS) || !okCode) {
  console.error('Usage: node src/scripts/setTimesheetDays.js "სახელი გვარი" 2026-10-01 2026-10-04 "ა/შ" [--apply]');
  process.exit(1);
}

await connectDB();
const rows = await TimesheetMember.find({ nameKa: nameKa.trim() }).lean();
if (rows.length !== 1) {
  console.log(rows.length ? "რამდენიმე ტაბელშია:" : `ტაბელში ვერ მოიძებნა: ${nameKa}`);
  rows.forEach((r) => console.log(`   ${r.sheet}: ${r.nameKa}`));
  await mongoose.disconnect();
  process.exit(0);
}
const row = rows[0];
const days = [];
for (let d = new Date(`${fromS}T00:00:00Z`); d <= new Date(`${toS}T00:00:00Z`); d = new Date(+d + 86400000)) {
  days.push(d.toISOString().slice(0, 10));
}
const shown = code === "auto" ? "ავტომატური" : code;
console.log(`\n${row.sheet}: ${row.nameKa}`);
console.log(`   ${days.map((k) => k.slice(8) + "." + k.slice(5, 7)).join(", ")} -> ${shown}`);
if (APPLY) {
  for (const date of days) {
    if (code === "auto") await TimesheetCell.deleteOne({ member: row._id, date });
    else {
      await TimesheetCell.updateOne(
        { member: row._id, date },
        { $set: { value: code } },
        { upsert: true }
      );
    }
  }
  console.log("\n✅ ჩაიწერა - ტაბელი განაახლე");
} else {
  console.log("\n(შემოწმება - ჩასაწერად დაამატე --apply)");
}
await mongoose.disconnect();
