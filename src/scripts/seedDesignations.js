// One-off script — creates the real company positions (from the legacy
// system) as Designation documents. Safe to re-run: skips any position
// name that already exists.
//
// Usage:
//   node src/scripts/seedDesignations.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Designation from "../models/Designation.js";

const POSITIONS = [
  "Admin",
  "Representative",
  "Group Manager",
  "Division Manager",
  "Director",
  "Office Manager",
  "Warehouse Manager",
  "Sales Manger",
  "Warehouse Head",
  "Training Manager",
  "Accountant",
  "Head Pharmacist",
  "Finance Manager",
  "Accounts And Logistics",
  "Regulatory",
  "Product Manager",
  "Accountant's Assistant",
  "Regional Manager",
  "Aesthetics Team",
];

async function run() {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const position of POSITIONS) {
    const existing = await Designation.findOne({ position });
    if (existing) {
      console.log(`Skipped (already exists): ${position}`);
      skipped++;
      continue;
    }
    await Designation.create({ position, isActive: true });
    console.log(`Created: ${position}`);
    created++;
  }

  console.log(`\nDone. Created: ${created}, skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
