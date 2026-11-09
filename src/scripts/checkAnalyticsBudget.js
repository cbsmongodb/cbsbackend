// Why does analytics show 0 paid? (read-only, changes nothing)
//   node src/scripts/checkAnalyticsBudget.js "თიგიშვილი" "ქეთევან მიქელაძე" "ნინო ცისკარიშვილი"
// 1st arg = employee name, the rest = doctor names (any word order, part of a name is fine)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Doctor from "../models/Doctor.js";
import Budget from "../models/Budget.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import { nameSearchFilter } from "../utils/nameSearch.js";

const [empQ, ...docQs] = process.argv.slice(2);
if (!empQ || !docQs.length) {
  console.error('Usage: node src/scripts/checkAnalyticsBudget.js "employee" "doctor 1" "doctor 2"');
  process.exit(1);
}
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const byName = (q) => nameSearchFilter(q, ["firstName", "lastName"]);
const month = (d) => {
  const x = new Date(new Date(d).getTime() + 4 * 3600e3);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`;
};
const nm = (x) => (x ? `${x.firstName || ""} ${x.lastName || ""}`.trim() : "?");

await connectDB();

const emps = await Employee.find(byName(empQ)).select("firstName lastName email isActive").lean();
console.log(`\n=== EMPLOYEE "${empQ}": ${emps.length} found`);
emps.forEach((e) => console.log(`  ${e._id}  ${nm(e)}  ${e.email || ""}  active=${e.isActive}`));
const empIds = new Set(emps.map((e) => String(e._id)));

for (const q of docQs) {
  const docs = await Doctor.find(byName(q)).select("firstName lastName isBudgeted").lean();
  console.log(`\n=== DOCTOR "${q}": ${docs.length} found${docs.length > 1 ? "  <-- MORE THAN ONE (duplicate?)" : ""}`);
  for (const d of docs) {
    console.log(`\n  doctor ${d._id}  ${nm(d)}  budgeted=${!!d.isBudgeted}`);

    const budgets = await Budget.find({ doctor: d._id })
      .select("employee date paidAmount isActive").populate("employee", "firstName lastName")
      .sort({ date: -1 }).limit(12).lean();
    console.log(`    BUDGETS (${budgets.length}):`);
    budgets.forEach((b) => {
      const mine = empIds.has(String(b.employee?._id));
      console.log(`      month ${b.date ? month(b.date) : "NO DATE"}  paid ${b.paidAmount}  active=${b.isActive}  employee: ${nm(b.employee)}${mine ? "" : "  <-- other employee"}`);
    });

    const entries = await DoctorEntryItem.aggregate([
      { $match: { doctor: d._id } },
      { $group: { _id: { e: "$employee", p: "$period" }, lines: { $sum: 1 } } },
      { $sort: { "_id.p": -1 } },
      { $limit: 12 },
    ]);
    const eNames = new Map(
      (await Employee.find({ _id: { $in: entries.map((x) => x._id.e) } }).select("firstName lastName").lean())
        .map((e) => [String(e._id), nm(e)])
    );
    console.log(`    PRESCRIPTION ENTRIES (what analytics rows come from):`);
    if (!entries.length) console.log("      none");
    entries.forEach((x) => {
      const mine = empIds.has(String(x._id.e));
      console.log(`      month ${month(x._id.p)}  ${x.lines} drug lines  employee: ${eNames.get(String(x._id.e)) || x._id.e}${mine ? "" : "  <-- other employee"}`);
    });
  }
}

await mongoose.disconnect();
