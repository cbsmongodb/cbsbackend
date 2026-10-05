import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";

async function run() {
  await connectDB();
  const role = await Role.findOne({ name: new RegExp("^group manager$", "i") });
  if (!role) { console.error("No Group Manager role"); await mongoose.disconnect(); return; }
  const p = role.privileges; // Mongoose Map
  const get = (k) => p.get ? p.get(k) : p[k];
  const dd = get("director_dashboard");
  console.log("director_dashboard:", dd ? JSON.stringify(dd) : "NOT SET");
  // count keys with read=1
  let count = 0, keys = [];
  if (p.forEach) p.forEach((v, k) => { if (v && v.read) { count++; keys.push(k); } });
  console.log("pages with read=1:", count);
  console.log("keys:", keys.join(", "));
  await mongoose.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
