// Creates 5 random test doctors for trying out the "which doctors did I
// see" checkout flow. Auto-creates the Profile/DoctorCategory if missing.
//
// Usage:
//   node src/scripts/seedTestDoctors.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Doctor from "../models/Doctor.js";
import Profile from "../models/Profile.js";
import DoctorCategory from "../models/DoctorCategory.js";

const DOCTORS = [
  { firstName: "Giorgi", lastName: "Test-Nevrologi", uniqueNumber: "TEST00001", profile: "Nevrolog / ნევროლოგი" },
  { firstName: "Nino", lastName: "Test-Kardiologi", uniqueNumber: "TEST00002", profile: "Kardiolog / კარდიოლოგი" },
  { firstName: "Levan", lastName: "Test-Terapevti", uniqueNumber: "TEST00003", profile: "Terapevt / თერაპევტი" },
  { firstName: "Tamar", lastName: "Test-Ginekologi", uniqueNumber: "TEST00004", profile: "Ginekolog / გინეკოლოგი" },
  { firstName: "Davit", lastName: "Test-Pediatri", uniqueNumber: "TEST00005", profile: "Pediatr / პედიატრი" },
];

async function run() {
  await connectDB();

  let defaultCategory = await DoctorCategory.findOne();
  if (!defaultCategory) {
    defaultCategory = await DoctorCategory.create({ name: "II კატეგორია" });
    console.log("Created default doctor category");
  }

  for (const d of DOCTORS) {
    const existing = await Doctor.findOne({ uniqueNumber: d.uniqueNumber });
    if (existing) {
      console.log(`Skipped (already exists): ${d.firstName} ${d.lastName}`);
      continue;
    }

    let profile = await Profile.findOne({ name: d.profile });
    if (!profile) {
      profile = await Profile.create({ name: d.profile });
      console.log(`Created profile: ${d.profile}`);
    }

    await Doctor.create({
      firstName: d.firstName,
      lastName: d.lastName,
      uniqueNumber: d.uniqueNumber,
      profile: profile._id,
      doctorCategory: defaultCategory._id,
      isActive: true,
    });
    console.log(`Created: ${d.firstName} ${d.lastName}`);
  }

  console.log("\nDone.");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
