// Creates 3 sample DoctorEntryItem rows (fake sales data) for a given
// employee + period, so you can see the Sales Listing / Sales Entry
// pages populated without filling the form by hand.
//
// Usage:
//   node src/scripts/createTestSalesData.js "email@example.com" "09/2026"
//
// NOTE: this writes the raw rows directly to MongoDB — it does NOT run
// the coefficient/plannedBudget/difference calculation (that logic lives
// inside the running server, not this standalone script). After running
// this, go to "გაყიდვების შეყვანა" → pick the same employee/period →
// click "ჩატვირთვა" (loads these rows) → click "შენახვა" (this re-saves
// them through the real API, which triggers the calculation) — then
// "გაყიდვების სია" will show Coefficient/Total Budget/etc. filled in.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Doctor from "../models/Doctor.js";
import Drug from "../models/Drug.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";

function normalizeToMonthStart(periodStr) {
  const [mm, yyyy] = periodStr.split("/");
  return new Date(Number(yyyy), Number(mm) - 1, 1);
}

async function run() {
  const [email, periodStr] = process.argv.slice(2);

  if (!email || !periodStr) {
    console.error('Usage: node src/scripts/createTestSalesData.js "email@example.com" "09/2026"');
    process.exit(1);
  }

  await connectDB();

  const employee = await Employee.findOne({ email: email.toLowerCase() });
  if (!employee) {
    console.error(`No employee found with email ${email}`);
    process.exit(1);
  }

  const doctor = await Doctor.findOne();
  if (!doctor) {
    console.error("No doctors found in the database — add at least one doctor first.");
    process.exit(1);
  }

  const drugs = await Drug.find().limit(3);
  if (drugs.length < 3) {
    console.error(`Only found ${drugs.length} drug(s) in the database — need at least 3.`);
    process.exit(1);
  }

  const period = normalizeToMonthStart(periodStr);

  const sampleValues = [
    { quota: 50, prescription: 40, sale: 35, budget: 2 },
    { quota: 30, prescription: 25, sale: 20, budget: 1.5 },
    { quota: 60, prescription: 55, sale: 50, budget: 3 },
  ];

  for (let i = 0; i < 3; i++) {
    const drug = drugs[i];
    const vals = sampleValues[i];

    await DoctorEntryItem.findOneAndUpdate(
      { employee: employee._id, doctor: doctor._id, drug: drug._id, period },
      {
        employee: employee._id,
        doctor: doctor._id,
        drug: drug._id,
        period,
        bank: "TBC",
        visits: "3",
        issuedBudget: 100,
        quota: vals.quota,
        prescription: vals.prescription,
        sale: vals.sale,
        budget: vals.budget,
      },
      { upsert: true, new: true, runValidators: true }
    );

    console.log(`Created/updated entry: ${drug.name} — quota ${vals.quota}, prescription ${vals.prescription}, sale ${vals.sale}`);
  }

  console.log(`\nDone. Employee: ${employee.email}, Doctor: ${doctor.firstName} ${doctor.lastName}, Period: ${periodStr}`);
  console.log('Now go to "გაყიდვების შეყვანა" → select this employee/period → "ჩატვირთვა" → "შენახვა" to trigger the coefficient/budget calculation.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
