// Read-only diagnostic — does NOT write anything to the database.
// For each of the 3 Section heads (division managers), prints exactly
// which employees getVisibleEmployeeIds() now resolves for them, so we
// can confirm the Group<->Section link from linkGroupsToSections.js
// actually fixed scoping before touching any theme/dashboard code.
//
// Usage:
//   node src/scripts/checkDivisionVisibility.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Section from "../models/Section.js";
import { getVisibleEmployeeIds } from "../utils/groupVisibility.js";

async function run() {
  await connectDB();

  const sections = await Section.find().populate("head", "firstName lastName email");

  for (const section of sections) {
    if (!section.head) {
      console.log(`\n=== ${section.name} — no head set, skipping ===`);
      continue;
    }

    const headEmployee = await Employee.findById(section.head._id);
    const visibleIds = await getVisibleEmployeeIds(headEmployee);
    const visibleEmployees = await Employee.find({ _id: { $in: visibleIds } }).select(
      "firstName lastName email"
    );

    console.log(
      `\n=== ${section.name} — head: ${section.head.firstName} ${section.head.lastName} (${section.head.email}) ===`
    );
    console.log(`Sees ${visibleEmployees.length} employee(s):`);
    visibleEmployees.forEach((e) => console.log(`  - ${e.firstName} ${e.lastName} (${e.email})`));
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
