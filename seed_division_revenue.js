import mongoose from "mongoose";
import dotenv from "dotenv";
import Division from "./src/models/Division.js";
import Employee from "./src/models/Employee.js";
import Doctor from "./src/models/Doctor.js";
import Drug from "./src/models/Drug.js";
import Prescription from "./src/models/Prescription.js";
import DrugPrescription from "./src/models/DrugPrescription.js";

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  // ensure 3 divisions exist
  const names = ["Division 1", "Division 2", "Division 3"];
  const divisions = [];
  for (const name of names) {
    let div = await Division.findOne({ name });
    if (!div) div = await Division.create({ name });
    divisions.push(div);
  }

  const employees = await Employee.find().limit(3);
  const doctors = await Doctor.find().limit(3);
  const drugs = await Drug.find({ isActive: true }).limit(3);

  if (employees.length < 3 || doctors.length < 1 || drugs.length < 1) {
    console.log(`Not enough data: ${employees.length} employees, ${doctors.length} doctors, ${drugs.length} drugs`);
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 12);

  // give each of the first 3 employees a different division, and different
  // sale volumes, so the pie chart shows 3 clearly different slices
  const salesPlan = [
    { boxesMultiplier: 3 }, // Division 1 — biggest slice
    { boxesMultiplier: 2 }, // Division 2 — medium slice
    { boxesMultiplier: 1 }, // Division 3 — smallest slice
  ];

  for (let i = 0; i < 3; i++) {
    const employee = employees[i];
    employee.division = divisions[i]._id;
    await employee.save();

    const doctor = doctors[i % doctors.length];

    const prescription = await Prescription.create({
      doctor: doctor._id,
      employee: employee._id,
      date: thisMonth,
      isActive: true,
    });

    for (let j = 0; j < drugs.length; j++) {
      const boxes = (10 + j * 5) * salesPlan[i].boxesMultiplier;
      await DrugPrescription.create({
        prescription: prescription._id,
        drug: drugs[j]._id,
        totalNoOfBoxes: boxes,
        saleBoxes: boxes,
      });
    }

    console.log(`${employee.name} -> ${divisions[i].name} (doctor: ${doctor.name})`);
  }

  console.log("\nDone — 3 employees now assigned to Division 1/2/3 with this-month sales.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
