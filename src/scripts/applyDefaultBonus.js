// Write the current bonuses (incl. the default 1) onto already entered
// prescription lines of the given months, and recalculate them.
//   node src/scripts/applyDefaultBonus.js 2026-10 2026-11            -> shows what would change
//   node src/scripts/applyDefaultBonus.js 2026-10 2026-11 --apply    -> really changes
// Only lines whose bonus is different from what the Bonuses page says are touched.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Drug from "../models/Drug.js";
import { parseMonth, monthLabel, restampBonuses } from "../utils/bonuses.js";

const APPLY = process.argv.includes("--apply");
const months = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a)).map(parseMonth);
if (!months.length) {
  console.error("Usage: node src/scripts/applyDefaultBonus.js 2026-10 2026-11 [--apply]");
  process.exit(1);
}

await connectDB();
for (const m of months) {
  const r = await restampBonuses(m, { dryRun: !APPLY });
  console.log(`\n${monthLabel(m)}: ${r.lines} prescription lines, ${r.changed} get a new bonus, ${r.employees} employee-months recalculated${APPLY ? "" : " (dry run)"}`);
  const byChange = new Map();
  r.changes.forEach(({ it, v }) => {
    const k = `${it.drug}|${it.budget || 0}|${v}`;
    byChange.set(k, (byChange.get(k) || 0) + 1);
  });
  const names = new Map((await Drug.find({ _id: { $in: [...new Set(r.changes.map((c) => c.it.drug))] } }).select("name").lean()).map((d) => [String(d._id), d.name]));
  [...byChange].sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, n]) => {
    const [drug, from, to] = k.split("|");
    console.log(`   ${names.get(drug) || drug}: ${from} -> ${to}  (${n} lines)`);
  });
}
console.log(APPLY ? "\nDONE" : "\nDRY RUN - nothing changed. Add --apply to write.");
await mongoose.disconnect();
