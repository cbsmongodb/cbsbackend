// One-off fix — reactivates an employee account (isActive: true) without
// needing to be logged in. Use this if a bulk import accidentally
// deactivated an account you need (e.g. your own).
//
// Usage:
//   node src/scripts/reactivateEmployee.js "email@example.com"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";

async function run() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node src/scripts/reactivateEmployee.js "email@example.com"');
    process.exit(1);
  }

  await connectDB();

  const employee = await Employee.findOneAndUpdate(
    { email: email.toLowerCase() },
    { isActive: true },
    { new: true }
  );

  if (!employee) {
    console.error(`No employee found with email ${email}`);
    process.exit(1);
  }

  console.log(`Reactivated: ${employee.firstName} ${employee.lastName} (${employee.email})`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
