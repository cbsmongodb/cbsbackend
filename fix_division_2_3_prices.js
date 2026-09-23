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

  // known-priced drugs from earlier in this session (real prices, not 0)
  const pricedDrugNames = ["Sepin", "Cefzy 1000", "Potas Mag"];
  const drugs = await Drug.find({ name: { $in: pricedDrugNames } });
  console.log("Priced drugs found:", drugs.map((d) => `${d.name} (${d.price})`));

  if (drugs.length === 0) {
    console.log("None of the priced drugs found — aborting.");
    await mongoose.disconnect();
    return;
  }

  const division2 = await Division.findOne({ name: "Division 2" });
  const division3 = await Division.findOne({ name: "Division 3" });

  const emp2 = await Employee.findOne({ division: division2._id, firstName: /Test/i });
  const emp3 = await Employee.findOne({ division: division3._id, firstName: /Khatia/i });

  const doctor = await Doctor.findOne();
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 18);

  for (const [label, employee, multiplier] of [
    ["Division 2", emp2, 2],
    ["Division 3", emp3, 1],
  ]) {
    if (!employee) {
      console.log(`${label}: employee not found, skipping`);
      continue;
    }

    const prescription = await Prescription.create({
      doctor: doctor._id,
      employee: employee._id,
      date: thisMonth,
      isActive: true,
    });

    for (let j = 0; j < drugs.length; j++) {
      const boxes = (10 + j * 5) * multiplier;
      await DrugPrescription.create({
        prescription: prescription._id,
        drug: drugs[j]._id,
        totalNoOfBoxes: boxes,
        saleBoxes: boxes,
      });
    }

    console.log(`${label}: added prescription with ${drugs.length} priced-drug lines for ${employee.name}`);
  }

  console.log("\nDone.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
