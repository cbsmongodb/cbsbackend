// Creates a single test employee for manual testing (e.g. GPS checkin/checkout).
//
// Usage:
//   node src/scripts/createTestEmployee.js "First" "Last" "email@example.com" "password"
import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

async function create() {
  const [firstName, lastName, email, password] = process.argv.slice(2);
  if (!firstName || !lastName || !email || !password) {
    console.error(
      'Usage: node src/scripts/createTestEmployee.js "First" "Last" "email@example.com" "password"'
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  await connectDB();

  let role = await Role.findOne({ name: "representative" });
  if (!role) {
    role = await Role.findOne();
    if (!role) {
      console.error("No roles exist yet — run seedAdmin.js first.");
      process.exit(1);
    }
    console.log(`No 'representative' role found — using existing role '${role.name}' instead.`);
  }

  const existing = await Employee.findOne({ email: email.toLowerCase() });
  if (existing) {
    existing.isActive = true;
    existing.role = role._id;
    existing.password = await bcrypt.hash(password, 10);
    await existing.save();
    console.log(`Employee ${email} already existed — reset password and saved.`);
    await mongoose.disconnect();
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  const employee = await Employee.create({
    firstName,
    lastName,
    email: email.toLowerCase(),
    password: hashed,
    role: role._id,
    isActive: true,
  });

  console.log(`Employee created: ${employee.email} (id: ${employee._id}) role: ${role.name}`);
  console.log("Log in with POST /api/auth/login using this email/password.");
  await mongoose.disconnect();
}

create().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
