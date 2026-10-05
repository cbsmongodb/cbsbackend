// Read-only: explains exactly why a login fails.
//   node src/scripts/checkLogin.js "email@example.com" "password"
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import "../models/Role.js";
import "../models/Group.js";

const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error('Usage: node src/scripts/checkLogin.js "email" "password"'); process.exit(1); }

async function run() {
  await connectDB();
  const target = email.trim().toLowerCase();
  const emp = await Employee.findOne({ email: target }).select("+password").populate("role").populate("group");

  if (!emp) {
    console.log(`\nNOT FOUND: no employee with email "${target}"`);
    const user = target.split("@")[0];
    const similar = await Employee.find({ email: new RegExp(user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).select("email isActive");
    console.log("Similar emails:", similar.length ? "" : "none");
    similar.forEach((s) => console.log(`  - ${JSON.stringify(s.email)}  isActive: ${s.isActive}`));
    await mongoose.disconnect();
    return;
  }

  const pwOk = await bcrypt.compare(password, emp.password || "");
  console.log(`\nFound: ${emp.firstName} ${emp.lastName}  (${JSON.stringify(emp.email)})`);
  console.log(`  isActive:      ${emp.isActive}${emp.isActive ? "" : "   <-- LOGIN BLOCKED: account inactive"}`);
  console.log(`  password ok:   ${pwOk}${pwOk ? "" : "   <-- LOGIN BLOCKED: wrong password"}`);
  console.log(`  role:          ${emp.role?.name || "NONE  <-- no role, pages will be empty"}`);
  console.log(`  group:         ${emp.group?.name || "none"}`);
  console.log(`  employeeType:  ${emp.employeeType}`);
  console.log(emp.isActive && pwOk ? "\n=> Backend login should SUCCEED." : "\n=> Backend login FAILS for the reason(s) marked above.");
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
