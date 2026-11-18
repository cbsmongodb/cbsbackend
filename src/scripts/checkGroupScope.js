// Group managers: does the sales filter show exactly their own group? (read only)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Role from "../models/Role.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";
import { divisionEmployeeIds } from "../routes/employeeSales/employeeSales.controller.js";

await connectDB();
const roles = await Role.find({ name: /^group manager/i }).select("_id").lean();
const mgrs = await Employee.find({ role: { $in: roles.map((r) => r._id) }, isActive: { $ne: false } })
  .populate("role", "name").populate({ path: "group", select: "name head members" }).select("firstName lastName email role group").lean();
const nm = async (ids) => (await Employee.find({ _id: { $in: ids } }).select("firstName lastName").lean()).map((e) => `${e.firstName} ${e.lastName}`);
let bad = 0;
for (const m of mgrs) {
  const g = m.group;
  const expected = new Set([String(m._id)]);
  if (g) {
    if (g.head) expected.add(String(g.head));
    (g.members || []).forEach((x) => expected.add(String(x)));
    (await Employee.find({ group: g._id }).select("_id").lean()).forEach((e) => expected.add(String(e._id)));
  }
  const seen = new Set((await divisionEmployeeIds(m)).map(String));
  const extra = [...seen].filter((x) => !expected.has(x));
  const missing = [...expected].filter((x) => !seen.has(x));
  const ok = !extra.length && !missing.length;
  if (!ok) bad++;
  console.log(`${ok ? "OK  " : "DIFF"} ${g?.name || "-"} | ${m.firstName} ${m.lastName} | expected ${expected.size}, sees ${seen.size}`);
  if (extra.length) console.log("     EXTRA (should not see):", (await nm(extra)).join(", "));
  if (missing.length) console.log("     MISSING:", (await nm(missing)).join(", "));
}
console.log(bad ? `\nproblems: ${bad}` : "\nall group managers see exactly their own group");
await mongoose.disconnect();
