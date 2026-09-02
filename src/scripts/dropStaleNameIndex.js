import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Designation from "../models/Designation.js";

async function run() {
  await connectDB();

  const indexes = await Designation.collection.indexes();
  console.log("Current indexes:", indexes.map((i) => i.name));

  const hasStaleIndex = indexes.some((i) => i.name === "name_1");
  if (!hasStaleIndex) {
    console.log('No "name_1" index found — nothing to drop.');
  } else {
    await Designation.collection.dropIndex("name_1");
    console.log('Dropped stale "name_1" index.');
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
