// მხოლოდ კითხულობს ბაზას. აჩვენებს, რომელ დივიზიონებს ხედავს რუსუდანი და რამდენ წამალს.
//   node src/scripts/checkRusudanDrugs.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";
import Section from "../models/Section.js";
import Group from "../models/Group.js";
import Drug from "../models/Drug.js";
import { getVisibleGroups, getVisibleDrugIds } from "../utils/groupVisibility.js";

await connectDB();
const emp = await Employee.findOne({ firstName: /^rusudan$/i, lastName: /^abzianidze$/i }).populate("role");
if (!emp) { console.log("რუსუდანი ვერ მოიძებნა"); process.exit(0); }
console.log("როლი:", emp.role?.name, "| ჯგუფი:", String(emp.group || "-"));
const priv = emp.role?.privileges;
for (const k of ["drugs", "product_types", "manufacturers"]) {
  const v = priv?.get ? priv.get(k) : priv?.[k];
  console.log(`უფლება ${k}:`, v ? JSON.stringify(v.toObject ? v.toObject() : v) : "არ აქვს");
}
const heads = await Section.find({ head: emp._id }).select("name groups").lean();
console.log("დივიზიონები, სადაც head არის:", heads.map((s) => s.name).join(", ") || "არცერთი");
const hg = await Group.find({ head: emp._id }).select("name section").lean();
console.log("ჯგუფები, სადაც head არის:", hg.map((g) => g.name).join(", ") || "არცერთი");
const groups = await getVisibleGroups(emp);
console.log("ხედავს ჯგუფებს:", groups.length, groups.map((g) => g.name).join(", "));
const ids = await getVisibleDrugIds(emp);
const drugs = await Drug.find({ _id: { $in: ids } }).select("name").lean();
console.log("ხედავს წამლებს:", drugs.length);
await mongoose.disconnect();
