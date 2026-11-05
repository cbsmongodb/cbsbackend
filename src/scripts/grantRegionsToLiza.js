// Gives Liza Gulashvili's role read access to the Regions page (/dashboard/regions).
//   node src/scripts/grantRegionsToLiza.js           (check only)
//   node src/scripts/grantRegionsToLiza.js --apply   (write)
// Access is per ROLE, so everyone with the same role gets it too.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const APPLY = process.argv.includes("--apply");
const KEY = "regions";

await connectDB();
console.log(APPLY ? "\nAPPLY - writing\n" : "\nCHECK ONLY - nothing is written\n");

const liza = await Employee.findOne({ email: /^gulashvililizi@gmail\.com$/i })
  .populate("role", "name").lean()
  || await Employee.findOne({ lastName: /gulashvili/i, firstName: /^li/i }).populate("role", "name").lean();

if (!liza) {
  console.log("❌ ლიზა გულაშვილი ვერ მოიძებნა");
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`ლიზა: ${liza.firstName} ${liza.lastName} <${liza.email}>`);
if (!liza.role) {
  console.log("❌ მას როლი არ აქვს მინიჭებული");
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`როლი: ${liza.role.name}`);

const role = await Role.findById(liza.role._id);
const current = role.privileges?.get?.(KEY) || {};
console.log(`ახლანდელი წვდომა რეგიონებზე: ${current.read === 1 ? "ნახვა ✔" : "არა"}`);

const sameRole = await Employee.find({ role: role._id, isActive: { $ne: false } })
  .select("firstName lastName email").lean();
console.log(`\nამ როლით (${sameRole.length}) — ყველა მიიღებს წვდომას:`);
sameRole.forEach((p) => console.log(`   - ${p.firstName} ${p.lastName}  ${p.email || ""}`));

if (current.read === 1) {
  console.log("\nℹ️  უკვე აქვს წვდომა — არაფერი შეიცვალა");
} else if (APPLY) {
  role.privileges.set(KEY, {
    read: 1, add: current.add || 0, update: current.update || 0, delete: current.delete || 0,
    import: current.import || 0, export: 1, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0,
  });
  role.markModified("privileges");
  await role.save();
  console.log("\n✅ ჩაიწერა: რეგიონები — ნახვა (რედაქტირების გარეშე). გამოსვლა/შესვლის მერე გამოუჩნდება.");
} else {
  console.log("\nყველაფერი სწორია? გაუშვი --apply-ით");
}
await mongoose.disconnect();
