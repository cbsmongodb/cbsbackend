import mongoose from "mongoose";
import dotenv from "dotenv";
import Drug from "./src/models/Drug.js";
import Prescription from "./src/models/Prescription.js";
import DrugPrescription from "./src/models/DrugPrescription.js";
import Doctor from "./src/models/Doctor.js";
import Employee from "./src/models/Employee.js";
import ProductType from "./src/models/ProductType.js";

dotenv.config();

// exact numbers from the Rails site's Monthly Product Sales table
const rows = [
  { name: "Sepin", openingStocks: 28079.0, saleBoxes: 2915, totalSaleAmount: 36758.15 },
  { name: "Cefzy 1000", openingStocks: 3912.0, saleBoxes: 2630, totalSaleAmount: 23222.9 },
  { name: "Potas Mag", openingStocks: 3148.57, saleBoxes: 648, totalSaleAmount: 10471.68 },
  { name: "aceflex-th", openingStocks: -1593.8, saleBoxes: 589, totalSaleAmount: 8216.55 },
  { name: "axytop shampoo 100g", openingStocks: -2927.0, saleBoxes: 411, totalSaleAmount: 7759.68 },
  { name: "milkden", openingStocks: -235.55, saleBoxes: 344, totalSaleAmount: 5579.68 },
  { name: "Fibraserta", openingStocks: 598.6, saleBoxes: 250, totalSaleAmount: 5397.5 },
  { name: "ELMAX", openingStocks: 1670.47, saleBoxes: 173, totalSaleAmount: 4494.54 },
  { name: "THYROKOMB", openingStocks: 538.79, saleBoxes: 156, totalSaleAmount: 4221.36 },
  { name: "Rebacto", openingStocks: 101.02, saleBoxes: 166, totalSaleAmount: 3862.82 },
];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const doctor = await Doctor.findOne();
  const employee = await Employee.findOne();
  const productType = await ProductType.findOne();
  if (!doctor) throw new Error("No Doctor found in DB — need at least one");
  if (!employee) throw new Error("No Employee found in DB — need at least one");
  if (!productType) throw new Error("No ProductType found in DB — need at least one");

  // clear any previously-seeded test prescriptions for these exact drug
  // names first, so re-running this script never double-counts
  const existingDrugIds = await Drug.find({ name: { $in: rows.map((r) => r.name) } }).distinct("_id");
  const existingPrescriptionIds = await DrugPrescription.find({ drug: { $in: existingDrugIds } }).distinct("prescription");
  await DrugPrescription.deleteMany({ drug: { $in: existingDrugIds } });
  await Prescription.deleteMany({ _id: { $in: existingPrescriptionIds } });
  console.log(`Cleared ${existingPrescriptionIds.length} previously-seeded prescriptions`);

  for (const row of rows) {
    const price = Math.round((row.totalSaleAmount / row.saleBoxes) * 100) / 100;

    let drug = await Drug.findOne({ name: row.name });
    if (!drug) {
      drug = await Drug.create({
        name: row.name,
        productType: productType._id,
        price,
        stocks: row.openingStocks,
        monthlyTarget: 0,
        isActive: true,
      });
      console.log(`Created drug: ${row.name}`);
    } else {
      drug.price = price;
      drug.stocks = row.openingStocks;
      await drug.save();
      console.log(`Updated drug: ${row.name}`);
    }

    const prescription = await Prescription.create({
      doctor: doctor._id,
      employee: employee._id,
      date: new Date(),
      totalNoOfDrugs: row.saleBoxes,
      isActive: true,
    });

    await DrugPrescription.create({
      prescription: prescription._id,
      drug: drug._id,
      totalNoOfBoxes: row.saleBoxes,
      saleBoxes: row.saleBoxes,
    });

    console.log(`  -> seeded ${row.saleBoxes} sale boxes, price ${price}`);
  }

  console.log("\nDone seeding Monthly Product Sales data.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
