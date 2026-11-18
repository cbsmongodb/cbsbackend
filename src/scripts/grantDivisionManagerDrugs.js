// Division Manager (მაგ. Rusudan Abzianidze): წამლების ნახვა, დამატება, რედაქტირება (ფასიც), წაშლა.
// სერვერი მაინც აჩვენებს მხოლოდ მისი დივიზიონ(ებ)ის წამლებს.
//   შემოწმება:  node src/scripts/grantDivisionManagerDrugs.js
//   შენახვა:    node src/scripts/grantDivisionManagerDrugs.js --apply
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

const APPLY = process.argv.includes("--apply");
const BASE = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
// product_types / manufacturers: მხოლოდ ნახვა (ფორმის ჩამონათვალებისთვის)
const GRANT = {
  drugs: { read: 1, add: 1, update: 1, delete: 1 },
  product_types: { read: 1 },
  manufacturers: { read: 1 },
};
const KEYS = ["read", "add", "update", "delete"];
const plain = (v) => (v ? (v.toObject ? v.toObject() : { ...v }) : {});
const show = (p) => KEYS.map((k) => `${k}:${p[k] || 0}`).join(" ");

await connectDB();

const rus = await Employee.findOne({ firstName: /^rusudan$/i, lastName: /^abzianidze$/i }).populate("role", "name").lean();
console.log("Rusudan Abzianidze როლი: " + (rus?.role?.name || "ვერ მოიძებნა"));

const byName = (await Role.find({})).filter((r) => {
  const n = r.name.toLowerCase().trim();
  return n === "division manager" || n.startsWith("division manager ");
});
const roles = new Map(byName.map((r) => [String(r._id), r]));
if (rus?.role?._id && !roles.has(String(rus.role._id))) {
  const own = await Role.findById(rus.role._id);
  if (own && String(own.name).toLowerCase() !== "admin") roles.set(String(own._id), own);
}

for (const role of roles.values()) {
  const people = await Employee.find({ role: role._id, isActive: { $ne: false } }).select("firstName lastName").lean();
  console.log(`\n== ${role.name} (${people.length} ადამიანი)`);
  people.forEach((p) => console.log(`   - ${p.firstName} ${p.lastName}`));
  for (const [key, on] of Object.entries(GRANT)) {
    const cur = { ...BASE, ...plain(role.privileges.get(key)) };
    const next = { ...cur };
    for (const [k, v] of Object.entries(on)) next[k] = Math.max(next[k] || 0, v);
    console.log(`   ${key.padEnd(14)} ახლა ${show(cur)}`);
    console.log(`   ${"".padEnd(14)} იქნება ${show(next)}`);
    role.privileges.set(key, next);
  }
  if (APPLY) { role.markModified("privileges"); await role.save(); console.log("   შენახულია"); }
}
if (!APPLY) console.log("\n(მხოლოდ შემოწმებაა: შესანახად დაუმატე --apply)");
else console.log("\nმზადაა: გვერდი გადატვირთონ (ან თავიდან შევიდნენ)");
await mongoose.disconnect();
