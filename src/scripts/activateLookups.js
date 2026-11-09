// Switch ON "active" in the small lookup lists (they were all created switched off).
//   node src/scripts/activateLookups.js           -> shows counts only
//   node src/scripts/activateLookups.js --apply   -> really switches them on
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Manufacturer from "../models/Manufacturer.js";
import ProducingCountry from "../models/ProducingCountry.js";
import Profile from "../models/Profile.js";
import ProductType from "../models/ProductType.js";
import DoctorCategory from "../models/DoctorCategory.js";
import DoctorSubcategory from "../models/DoctorSubcategory.js";

const APPLY = process.argv.includes("--apply");
await connectDB();
for (const [name, M] of Object.entries({ Manufacturer, ProducingCountry, Profile, ProductType, DoctorCategory, DoctorSubcategory })) {
  const off = await M.countDocuments({ isActive: { $ne: true } });
  const all = await M.countDocuments({});
  if (APPLY && off) await M.updateMany({ isActive: { $ne: true } }, { $set: { isActive: true } });
  console.log(`${name}: ${off} of ${all} switched off${APPLY && off ? " -> now active" : ""}`);
}
console.log(APPLY ? "\nDONE" : "\nDRY RUN - add --apply to switch them on");
await mongoose.disconnect();
