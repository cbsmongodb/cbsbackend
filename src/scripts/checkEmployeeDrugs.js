// Read-only — writes nothing. Shows why an employee doesn't see all drugs of a group.
//   node src/scripts/checkEmployeeDrugs.js "kuprashvili" "M3"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Drug from "../models/Drug.js";
import "../models/Role.js";
import { getVisibleGroups, getVisibleDrugIds, seesEverything } from "../utils/groupVisibility.js";

const [who = "kuprashvili", groupName = "M3"] = process.argv.slice(2);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
await connectDB();

const rx = new RegExp(esc(who), "i");
const emps = await Employee.find({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }, { name: rx }] }).populate("role").lean();
const group = await Group.findOne({ name: new RegExp(`^\\s*${esc(groupName)}\\s*$`, "i") }).lean()
  || await Group.findOne({ name: new RegExp(esc(groupName), "i") }).lean();
if (!group) { console.log(`❌ ჯგუფი "${groupName}" ვერ ვიპოვე`); process.exit(0); }

const gDrugs = await Drug.find({ _id: { $in: group.drugs || [] } }).select("name isActive").lean();
const gone = (group.drugs || []).length - gDrugs.length;
console.log(`\nჯგუფი "${group.name}": ${group.drugs?.length || 0} წამალი${gone ? ` (${gone} წაშლილია ბაზიდან!)` : ""}`);
gDrugs.sort((a, b) => a.name.localeCompare(b.name)).forEach((d) => console.log(`   ${d.isActive ? "✅ აქტიური   " : "⛔ არააქტიური"}  ${d.name}`));
const inactive = gDrugs.filter((d) => !d.isActive).length;
console.log(`   → აქტიური ${gDrugs.length - inactive}, არააქტიური ${inactive}`);

if (!emps.length) console.log(`\n❌ თანამშრომელი "${who}" ვერ ვიპოვე`);
for (const e of emps) {
  console.log(`\n=== ${e.firstName} ${e.lastName} (${e.email}) ${e.isActive ? "" : "[INACTIVE]"}`);
  console.log(`   როლი: ${e.role?.name || "-"}`);
  const own = e.group ? await Group.findById(e.group).select("name").lean() : null;
  console.log(`   საკუთარი ჯგუფი: ${own?.name || "არ აქვს"}${own && String(own._id) === String(group._id) ? "" : "   ⚠️ არ არის " + group.name}`);
  if (seesEverything(e)) { console.log("   ყველა წამალს ხედავს (გლობალური როლი)"); continue; }
  const vg = await getVisibleGroups(e);
  if (vg.length) console.log(`   ხელმძღვანელია ჯგუფების: ${vg.map((g) => `${g.name}(${g.drugs?.length || 0})`).join(", ")}  ← ხედავს მხოლოდ ამათ წამლებს`);
  const vis = new Set(await getVisibleDrugIds(e));
  const missing = gDrugs.filter((d) => !vis.has(String(d._id)));
  console.log(`   ხედავს სულ ${vis.size} წამალს; "${group.name}"-დან ხედავს ${gDrugs.length - missing.length}/${gDrugs.length}`);
  missing.forEach((d) => console.log(`      ✗ ვერ ხედავს: ${d.name}`));
  const shown = gDrugs.filter((d) => vis.has(String(d._id)) && d.isActive).length;
  console.log(`   ექიმის ჩანაწერში (მხოლოდ აქტიური) გამოუჩნდება: ${shown}`);
}
await mongoose.disconnect();
