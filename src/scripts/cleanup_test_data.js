// Finds test data and suspicious numbers. Nothing is deleted without --apply.
//   node src/scripts/cleanup_test_data.js            (show only)
//   node src/scripts/cleanup_test_data.js --apply    (delete what is listed under "WILL DELETE")
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Doctor from "../models/Doctor.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import PlanConfigurationDoctor from "../models/PlanConfigurationDoctor.js";
import EmployeeSale from "../models/EmployeeSale.js";
import "../models/Drug.js";
import "../models/Employee.js";

const APPLY = process.argv.includes("--apply");
await connectDB();
const nm = (p) => (p ? `${p.firstName || ""} ${p.lastName || ""}`.trim() : "?");
const month = (d) => new Date(new Date(d).getTime() + 12 * 3600e3).toISOString().slice(0, 7);

// 1. test doctors: "test" / "ტესტ" in the name
const TEST = /test|ტესტ/i;
const testDoctors = await Doctor.find({ $or: [{ firstName: TEST }, { lastName: TEST }] });
console.log(`\nTEST DOCTORS (${testDoctors.length}):`);
testDoctors.forEach((d) => console.log(`  ${nm(d)}  (${d.uniqueNumber})`));
const testIds = testDoctors.map((d) => d._id);

// 2. data entry lines on test doctors
const testLines = await DoctorEntryItem.find({ doctor: { $in: testIds } }).populate("employee", "firstName lastName").populate("drug", "name");
console.log(`\nDATA ENTRY LINES ON TEST DOCTORS (${testLines.length}):`);
testLines.slice(0, 30).forEach((l) => console.log(`  ${month(l.period)} | ${nm(l.employee)} | ${l.drug?.name} | rx ${l.prescription}`));

// 3. lines whose doctor was deleted (shown as "(deleted doctor)")
const allDoctorIds = new Set((await Doctor.find({}).select("_id")).map((d) => String(d._id)));
const lineDoctors = await DoctorEntryItem.distinct("doctor");
const goneIds = lineDoctors.filter((id) => id && !allDoctorIds.has(String(id)));
const orphanLines = await DoctorEntryItem.find({ $or: [{ doctor: { $in: goneIds } }, { doctor: null }] }).populate("employee", "firstName lastName").populate("drug", "name");
console.log(`\nLINES WITH A DELETED / MISSING DOCTOR (${orphanLines.length}):`);
orphanLines.slice(0, 30).forEach((l) => console.log(`  ${month(l.period)} | ${nm(l.employee)} | ${l.drug?.name} | rx ${l.prescription}`));

// 4. visit plans pointing at test doctors
const testPlanLinks = await PlanConfigurationDoctor.countDocuments({ doctor: { $in: testIds } });
console.log(`\nVISIT PLAN LINKS TO TEST DOCTORS: ${testPlanLinks}`);

// 5. suspicious numbers (NOT deleted, only shown - check them in the old CRM)
const huge = await DoctorEntryItem.find({ totalBudget: { $gt: 20000 } }).sort({ totalBudget: -1 }).limit(20)
  .populate("employee", "firstName lastName").populate("doctor", "firstName lastName").populate("drug", "name");
console.log(`\nSUSPICIOUS: total budget over 20,000 GEL on one line (${huge.length}) - not deleted, check them:`);
huge.forEach((l) => console.log(`  ${Math.round(l.totalBudget).toLocaleString("en-US")} GEL | ${month(l.period)} | ${nm(l.employee)} | dr ${nm(l.doctor)} | ${l.drug?.name} | rx ${l.prescription} bonus ${l.budget} coef ${l.coefficient}`));

// 6. pharmacy sales typed in the last 14 days (possible tests) - not deleted, only shown
const recentSales = await EmployeeSale.find({ createdAt: { $gte: new Date(Date.now() - 14 * 86400000) } }).populate("employee", "firstName lastName");
console.log(`\nPHARMACY SALES ENTERED IN THE LAST 14 DAYS (${recentSales.length}) - not deleted, check if they are tests:`);
recentSales.forEach((s) => console.log(`  ${month(s.date)} | ${nm(s.employee)} | created ${s.createdAt.toISOString().slice(0, 10)} | id ${s._id}`));

console.log(`\nWILL DELETE with --apply: ${testLines.length + orphanLines.length} data entry lines, ${testPlanLinks} visit plan links, ${testDoctors.length} test doctors`);
if (APPLY) {
  const a = await DoctorEntryItem.deleteMany({ _id: { $in: [...testLines, ...orphanLines].map((l) => l._id) } });
  const b = await PlanConfigurationDoctor.deleteMany({ doctor: { $in: testIds } });
  const c = await Doctor.deleteMany({ _id: { $in: testIds } });
  console.log(`\nDONE: deleted ${a.deletedCount} lines, ${b.deletedCount} plan links, ${c.deletedCount} test doctors.`);
} else {
  console.log("Nothing deleted. Run again with --apply to delete the list above.");
}
await mongoose.disconnect();
