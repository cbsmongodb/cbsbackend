// Remove (or, if it is used somewhere, deactivate) one employee by e-mail.
//   node src/scripts/removeEmployee.js someone@mail.com          (preview only)
//   node src/scripts/removeEmployee.js someone@mail.com --apply  (do it)
// Counts every record in the database that points at the employee. If NOTHING
// points at them -> deleted. If something does -> only isActive = false, so
// no history (sales, leaves, prescriptions...) is left pointing at nothing.
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";

const email = (process.argv[2] || "").toLowerCase();
const APPLY = process.argv.includes("--apply");
if (!email || email.startsWith("--")) { console.error("Usage: node src/scripts/removeEmployee.js <email> [--apply]"); process.exit(1); }

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../models");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".js"))) await import(pathToFileURL(path.join(dir, f)).href);

await connectDB();
const emp = await Employee.findOne({ email }).select("firstName lastName email isActive").lean();
if (!emp) { console.log("not found:", email); process.exit(1); }
console.log(`${APPLY ? "APPLY" : "PREVIEW (nothing changed)"}: ${emp.firstName} ${emp.lastName} <${emp.email}> active=${emp.isActive}`);

let total = 0;
for (const name of mongoose.modelNames()) {
  const M = mongoose.model(name);
  const paths = [];
  M.schema.eachPath((p, t) => {
    const ref = t.options?.ref || t.caster?.options?.ref || t.options?.type?.[0]?.ref;
    if (ref === "Employee" && !(name === "Employee" && p === "_id")) paths.push(p);
  });
  for (const p of paths) {
    const n = await M.countDocuments({ [p]: emp._id });
    if (n) { console.log(`  ${name}.${p}: ${n}`); total += n; }
  }
}
console.log(total ? `references: ${total} -> will be DEACTIVATED, not deleted` : "references: 0 -> will be DELETED");
if (APPLY) {
  if (total) { await Employee.updateOne({ _id: emp._id }, { $set: { isActive: false } }); console.log("deactivated"); }
  else { await Employee.deleteOne({ _id: emp._id }); console.log("deleted"); }
} else console.log("looks right? run again with --apply");
await mongoose.disconnect();
