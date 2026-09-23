import mongoose from "mongoose";
import dotenv from "dotenv";
import Employee from "./src/models/Employee.js";
import Division from "./src/models/Division.js";
import Prescription from "./src/models/Prescription.js";
import DrugPrescription from "./src/models/DrugPrescription.js";
import Drug from "./src/models/Drug.js";

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const div2 = await Division.findOne({ name: "Division 2" });
  const div3 = await Division.findOne({ name: "Division 3" });

  console.log("Division 2 id:", div2?._id, "  Division 3 id:", div3?._id);

  for (const [label, div] of [["Division 2", div2], ["Division 3", div3]]) {
    const emps = await Employee.find({ division: div._id });
    console.log(`\n${label} employees:`, emps.map((e) => e.name));

    const empIds = emps.map((e) => e._id);
    const prescriptions = await Prescription.find({ employee: { $in: empIds } });
    console.log(`${label} prescriptions found:`, prescriptions.length);
    prescriptions.forEach((p) => console.log("  date:", p.date));

    const items = await DrugPrescription.find({
      prescription: { $in: prescriptions.map((p) => p._id) },
    }).populate("drug", "name price");
    console.log(`${label} drug prescription lines:`, items.length);
    items.forEach((it) => console.log(`  ${it.drug?.name}: saleBoxes=${it.saleBoxes}, price=${it.drug?.price}`));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
