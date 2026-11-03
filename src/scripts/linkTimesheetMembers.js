// Links timesheet rows (Georgian names) to CRM employees, so leaves show up.
//   node src/scripts/linkTimesheetMembers.js           (check only)
//   node src/scripts/linkTimesheetMembers.js --apply   (write)
// Only rows that are NOT linked yet are touched; a row is linked only when
// exactly one active employee matches (surname + first name).
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import TimesheetMember from "../models/TimesheetMember.js";

const APPLY = process.argv.includes("--apply");
// nameKa on the timesheet -> surname (Latin, regex) + first name start
const MAP = {
  "ნინო ბასილიძე": { last: "Basilidze", first: "Nino" },
  "ბორის ზიბზიბაძე": { last: "Zibzibadze", first: "" },
  "აგნესა ბართაია": { last: "Bartaia", first: "Agn" },
  "ფატიმა შამიმ": { last: "Shamim", first: "Fat" },
  "სამარ შამიმ": { last: "Shamim", first: "Sam" },
  "ნატალია გივიშვილი": { last: "Givishvili", first: "Nat" },
  "მაია გიაშვილი": { last: "Giashvili", first: "Mai" },
};

await connectDB();
const rows = await TimesheetMember.find({ employee: null }).lean();
let linked = 0;
for (const r of rows) {
  const rule = MAP[(r.nameKa || "").trim()];
  if (!rule) {
    console.log(`·  ${r.sheet}: ${r.nameKa} - წესი არ მაქვს, გამოვტოვე`);
    continue;
  }
  const all = await Employee.find({
    lastName: new RegExp(`^\\s*${rule.last}\\s*$`, "i"),
  }).select("firstName lastName email isActive").lean();
  const f = new RegExp(`^\\s*(${rule.first})`, "i");
  const match = rule.first ? all.filter((e) => f.test(e.firstName || "")) : all;
  const active = match.filter((e) => e.isActive !== false);
  const pick = active.length === 1 ? active : match;
  if (pick.length !== 1) {
    const why = pick.length ? "რამდენიმე მოიძებნა" : "სისტემაში ვერ მოიძებნა";
    console.log(`❌ ${r.sheet}: ${r.nameKa} - ${why}`);
    all.forEach((e) => console.log(`     ${e.firstName} ${e.lastName}  ${e.email}${e.isActive === false ? "  (inactive)" : ""}`));
    continue;
  }
  const e = pick[0];
  const off = e.isActive === false ? "  (inactive)" : "";
  console.log(`✅ ${r.sheet}: ${r.nameKa} -> ${e.firstName} ${e.lastName} <${e.email}>${off}`);
  if (APPLY) await TimesheetMember.updateOne({ _id: r._id }, { $set: { employee: e._id } });
  linked++;
}
console.log(`\n${APPLY ? "მიება" : "მიებმება"}: ${linked} / ${rows.length}`);
if (!APPLY) console.log("სწორია? გაუშვი --apply-ით");
await mongoose.disconnect();
