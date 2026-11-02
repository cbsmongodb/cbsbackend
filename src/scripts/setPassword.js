// Set a new password for one employee
// node src/scripts/setPassword.js "email" "newPassword"
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";

const email = (process.argv[2] || "").trim().toLowerCase();
const pw = process.argv[3] || "";
if (!email || !pw) {
  console.error("Usage: node ... \"email\" \"password\"");
  process.exit(1);
}

await connectDB();
const hash = await bcrypt.hash(pw, 10);
const e = await Employee.findOneAndUpdate(
  { email },
  { password: hash },
  { new: true }
)
  .select("firstName lastName isActive")
  .lean();
if (!e) {
  console.log("? " + email + ": not found");
} else {
  console.log("OK: " + e.firstName + " " + e.lastName);
  if (!e.isActive) console.log("NOTE: account is INACTIVE");
}
await mongoose.disconnect();
