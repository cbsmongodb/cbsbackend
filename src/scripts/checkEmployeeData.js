// What does the database have for an employee? (read-only)
//   node src/scripts/checkEmployeeData.js "ღონღაძე"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { nameSearchFilter } from "../utils/nameSearch.js";
import Employee from "../models/Employee.js";
import Budget from "../models/Budget.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";
import PlanConfiguration from "../models/PlanConfiguration.js";
import "../models/Role.js";
import "../models/Group.js";

const q = process.argv[2];
if (!q) { console.error('Usage: node src/scripts/checkEmployeeData.js "name"'); process.exit(1); }
const month = (d) => { const x = new Date(new Date(d).getTime() + 4 * 3600e3); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}`; };
const byMonth = async (Model, field, id) =>
  (await Model.find({ [field === "period" || field === "date" ? "employee" : "performer"]: id }).select(field).lean())
    .reduce((m, x) => { const k = x[field] ? month(x[field]) : "no date"; m[k] = (m[k] || 0) + 1; return m; }, {});

await connectDB();
const emps = await Employee.find(nameSearchFilter(q, ["firstName", "lastName", "email"]))
  .populate("role", "name").populate("group", "name").lean();
console.log(`\n"${q}": ${emps.length} employee record(s)${emps.length > 1 ? "  <-- MORE THAN ONE" : ""}`);
for (const e of emps) {
  console.log(`\n  ${e._id}  ${e.firstName} ${e.lastName}  ${e.email || ""}`);
  console.log(`    role: ${e.role?.name || "—"}   group: ${e.group?.name || "— (NO GROUP)"}   active: ${e.isActive}`);
  console.log(`    budgets by month:      ${JSON.stringify(await byMonth(Budget, "date", e._id))}`);
  console.log(`    rx entries by month:   ${JSON.stringify(await byMonth(DoctorEntryItem, "period", e._id))}`);
  console.log(`    visits (as performer): ${JSON.stringify(await byMonth(PlanConfiguration, "period_p", e._id))}`);
}
await mongoose.disconnect();
