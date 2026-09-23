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

  let division2 = await Division.findOne({ name: "Division 2" });
  if (!division2) division2 = await Division.create({ name: "Division 2" });
  let division3 = await Division.findOne({ name: "Division 3" });
  if (!division3) division3 = await Division.create({ name: "Division 3" });

  const employees = await Employee.find().skip(1).limit(2); // skip employees[0] (already Division 1)
  const doctors = await Doctor.find().limit(3);
  const drugs = await Drug.find({ isActive: true }).limit(3);

  console.log(`Found: ${employees.length} employees (offset 1), ${doctors.length} doctors, ${drugs.length} drugs`);

  if (employees.length < 2 || doctors.length < 1 || drugs.length < 1) {
    console.log("Not enough data to seed both divisions.");
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

  const plan = [
    { division: division2, employee: employees[0], multiplier: 2 },
    { division: division3, employee: employees[1], multiplier: 1 },
  ];

  for (const item of plan) {
    item.employee.division = item.division._id;
    await item.employee.save();

    const doctor = doctors[Math.floor(Math.random() * doctors.length)];

    const prescription = await Prescription.create({
      doctor: doctor._id,
      employee: item.employee._id,
      date: thisMonth,
      isActive: true,
    });

    for (let j = 0; j < drugs.length; j++) {
      const boxes = (10 + j * 5) * item.multiplier;
      await DrugPrescription.create({
        prescription: prescription._id,
        drug: drugs[j]._id,
        totalNoOfBoxes: boxes,
        saleBoxes: boxes,
      });
    }

    console.log(`${item.employee.name} -> ${item.division.name} (doctor: ${doctor.name}, ${drugs.length} drug lines)`);
  }

  console.log("\nDone — Division 2 and Division 3 now have this-month sales data.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
