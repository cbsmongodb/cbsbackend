// One-off script — links the 5 TEST doctors (created by
// seedTestDoctors.js) to the "Smail care" hospital, so they show up in
// the checkout doctor-picker for that hospital. Safe to re-run.
//
// Usage:
//   node src/scripts/linkTestDoctorsToSmailCare.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Doctor from "../models/Doctor.js";
import Hospital from "../models/Hospital.js";

async function run() {
  await connectDB();

  const hospital = await Hospital.findOne({ name: /smail care/i });
  if (!hospital) {
    console.error('No hospital found matching "Smail care"');
    process.exit(1);
  }
  console.log(`Found hospital: ${hospital.name} (${hospital._id})`);

  const testDoctors = await Doctor.find({ uniqueNumber: /^TEST/ });
  if (testDoctors.length === 0) {
    console.error("No TEST doctors found — run seedTestDoctors.js first");
    process.exit(1);
  }

  let updated = 0;
  for (const doc of testDoctors) {
    const already = (doc.hospitals || []).some(
      (h) => String(h.hospital) === String(hospital._id)
    );
    if (already) {
      console.log(`Already linked: ${doc.firstName} ${doc.lastName}`);
      continue;
    }
    doc.hospitals = [...(doc.hospitals || []), { hospital: hospital._id }];
    await doc.save();
    console.log(`Linked: ${doc.firstName} ${doc.lastName}`);
    updated++;
  }

  console.log(`\nDone. Linked: ${updated}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
