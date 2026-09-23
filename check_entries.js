import mongoose from "mongoose";
import dotenv from "dotenv";
import Employee from "./src/models/Employee.js";
import DoctorEntryItem from "./src/models/DoctorEntryItem.js";
import Budget from "./src/models/Budget.js";

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  const emp = await Employee.findOne({ firstName: /liza/i, lastName: /bogveradze/i });
  console.log("Employee ID:", emp?._id);

  const items = await DoctorEntryItem.find({ employee: emp._id }).sort({ period: -1 }).limit(5);
  console.log("\nDoctorEntryItem records (most recent 5):");
  items.forEach(i => console.log("  period:", i.period, "| prescription:", i.prescription, "| quota:", i.quota, "| sale:", i.sale));

  const budgets = await Budget.find({ employee: emp._id }).sort({ date: -1 }).limit(5);
  console.log("\nBudget records (most recent 5):");
  budgets.forEach(b => console.log("  date:", b.date, "| paidAmount:", b.paidAmount));

  await mongoose.disconnect();
}

main();
