// Read-only diagnostic — does NOT write anything to the database.
// Prints each Group's name and how many drugs it currently has assigned,
// so we know which groups still need drugs selected via the Groups
// admin page (/dashboard/groups) before non-admin employees can see
// anything on the Drugs page.
//
// Usage:
//   node src/scripts/checkGroupDrugs.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Group from "../models/Group.js";

async function run() {
  await connectDB();

  const groups = await Group.find().sort({ name: 1 }).select("name drugs");

  console.log("Group -> assigned drug count:\n");
  let totalAssigned = 0;
  for (const g of groups) {
    const count = g.drugs?.length || 0;
    totalAssigned += count;
    console.log(`  ${g.name}: ${count}`);
  }

  console.log(`\n${groups.length} group(s) total, ${totalAssigned} drug-assignment(s) total.`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
