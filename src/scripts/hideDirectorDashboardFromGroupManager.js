import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";

const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };

async function run() {
  await connectDB();
  const role = await Role.findOne({ name: new RegExp("^group manager$", "i") });
  if (!role) { console.error("No Group Manager role"); await mongoose.disconnect(); process.exit(1); }

  // privileges is a Mongoose Map — use .set()
  role.privileges.set("director_dashboard", OFF);
  role.markModified("privileges");
  await role.save();

  const dd = role.privileges.get("director_dashboard");
  console.log("director_dashboard now:", JSON.stringify(dd));
  await mongoose.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
