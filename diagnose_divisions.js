import mongoose from "mongoose";
import dotenv from "dotenv";
import Division from "./src/models/Division.js";
import Employee from "./src/models/Employee.js";
import Prescription from "./src/models/Prescription.js";

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const divisions = await Division.find();
  console.log("All Divisions in DB:");
  divisions.forEach((d) => console.log(`  - ${d.name} (${d._id})`));

  console.log("\nEmployees with a division set:");
  const employees = await Employee.find({ division: { $ne: null } }).populate("division", "name");
  employees.forEach((e) => console.log(`  - ${e.name} -> ${e.division?.name}`));

  console.log("\nPrescriptions this month:");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prescriptions = await Prescription.find({ date: { $gte: monthStart } }).populate("employee", "firstName lastName");
  prescriptions.forEach((p) => console.log(`  - ${p.employee?.name || "?"} on ${p.date?.toISOString().slice(0,10)}`));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
