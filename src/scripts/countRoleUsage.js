import "dotenv/config";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Role from "../models/Role.js";
import mongoose from "mongoose";

async function run() {
  await connectDB();

  const roles = await Role.find();
  for (const role of roles) {
    const count = await Employee.countDocuments({ role: role._id });
    console.log(`${role.name}: ${count} employee(s)`);
  }

  await mongoose.disconnect();
}

run();
