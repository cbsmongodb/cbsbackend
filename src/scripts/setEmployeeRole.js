// One-off fix — sets a specific employee's role by role name, without
// needing to be logged in. Use this if a bulk import accidentally
// changed an account's role to something with no configured permissions.
//
// Usage:
//   node src/scripts/setEmployeeRole.js "email@example.com" "admin"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Role from "../models/Role.js";

async function run() {
  const [email, roleName] = process.argv.slice(2);
  if (!email || !roleName) {
    console.error('Usage: node src/scripts/setEmployeeRole.js "email@example.com" "admin"');
    process.exit(1);
  }

  await connectDB();

  const role = await Role.findOne({ name: new RegExp(`^${roleName}$`, "i") });
  if (!role) {
    console.error(`No role found named "${roleName}"`);
    process.exit(1);
  }

  const employee = await Employee.findOneAndUpdate(
    { email: email.toLowerCase() },
    { role: role._id },
    { new: true }
  );

  if (!employee) {
    console.error(`No employee found with email ${email}`);
    process.exit(1);
  }

  console.log(`Set role "${role.name}" on: ${employee.firstName} ${employee.lastName} (${employee.email})`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
