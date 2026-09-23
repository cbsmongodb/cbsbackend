import mongoose from "mongoose";
import dotenv from "dotenv";
import Doctor from "./src/models/Doctor.js";
import Employee from "./src/models/Employee.js";
import Drug from "./src/models/Drug.js";
import Prescription from "./src/models/Prescription.js";
import DrugPrescription from "./src/models/DrugPrescription.js";
import DoctorTarget from "./src/models/DoctorTarget.js";
import MedicineTarget from "./src/models/MedicineTarget.js";
import Budget from "./src/models/Budget.js";

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const doctors = await Doctor.find().limit(3);
  const employees = await Employee.find().limit(2);
  const drugs = await Drug.find({ isActive: true }).limit(4);

  if (doctors.length < 2 || employees.length < 1 || drugs.length < 2) {
    console.log("Not enough doctors/employees/drugs in DB to seed analytics test data.");
    console.log(`Found: ${doctors.length} doctors, ${employees.length} employees, ${drugs.length} drugs`);
    await mongoose.disconnect();
    return;
  }

  // give a couple of drugs a bonus value, so "payable" / "coefficient"
  // columns show something non-zero in the demo
  drugs[0].bonus = 5;
  await drugs[0].save();
  if (drugs[1]) {
    drugs[1].bonus = 3;
    await drugs[1].save();
  }

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 10);

  let created = 0;

  for (const doctor of doctors) {
    for (const employee of employees) {
      // DoctorTarget for this pair, this month
      const doctorTarget = await DoctorTarget.create({
        doctor: doctor._id,
        employee: employee._id,
        date: thisMonth,
      });

      // MedicineTarget entries — 2-3 drugs, random-ish box counts
      for (let i = 0; i < Math.min(3, drugs.length); i++) {
        await MedicineTarget.create({
          medicineTargatableType: "DoctorTarget",
          medicineTargatableId: doctorTarget._id,
          drug: drugs[i]._id,
          totalNoOfBoxes: 20 + i * 15,
        });
      }

      // Prescription + DrugPrescription for the same pair/month
      const prescription = await Prescription.create({
        doctor: doctor._id,
        employee: employee._id,
        date: thisMonth,
        isActive: true,
      });

      for (let i = 0; i < Math.min(3, drugs.length); i++) {
        const total = 15 + i * 10;
        const sold = Math.round(total * (0.4 + i * 0.15)); // partial fulfillment, varies per drug
        await DrugPrescription.create({
          prescription: prescription._id,
          drug: drugs[i]._id,
          totalNoOfBoxes: total,
          saleBoxes: sold,
        });
      }

      // Budget record — for Paid/Delta columns
      await Budget.create({
        doctor: doctor._id,
        employee: employee._id,
        date: thisMonth,
        paidAmount: 150 + Math.round(Math.random() * 300),
        advanceAmount: Math.round((Math.random() - 0.5) * 200),
        isActive: true,
      });

      created++;
      console.log(`Seeded: ${doctor.name} x ${employee.name}`);
    }
  }

  console.log(`\nDone — seeded ${created} doctor x employee analytics pairs for this month.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
