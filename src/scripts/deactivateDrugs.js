// Hides OLD drugs (isActive=false). Nothing is deleted - you can switch them back on.
//   node src/scripts/deactivateDrugs.js "Sepin" "Cefzy 1000"           -> only shows what would happen
//   node src/scripts/deactivateDrugs.js --apply "Sepin" "Cefzy 1000"   -> does it
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Drug from "../models/Drug.js";
import MedicineTarget from "../models/MedicineTarget.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const names = args.filter((a) => a !== "--apply");
if (!names.length) { console.log('usage: node src/scripts/deactivateDrugs.js [--apply] "Drug 1" "Drug 2"'); process.exit(1); }

await connectDB();
for (const n of names) {
  const esc = n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = await Drug.find({ name: new RegExp(`^${esc}$`, "i") }).select("name isActive stocks price").lean();
  if (!found.length) { console.log(`?  not found: ${n}`); continue; }
  for (const d of found) {
    const sales = await MedicineTarget.countDocuments({ drug: d._id, medicineTargatableType: "EmployeeSale" });
    const rx = await DoctorEntryItem.countDocuments({ drug: d._id });
    console.log(`${apply ? "->" : "·"}  ${d.name} | active=${d.isActive} | stock=${d.stocks} | sale lines=${sales} | prescription rows=${rx}`);
    if (apply) await Drug.updateOne({ _id: d._id }, { $set: { isActive: false } });
  }
}
console.log(apply ? "\nDONE - these drugs are now hidden." : "\nPreview only. Add --apply to hide them.");
await mongoose.disconnect();
