// Travel-expenses workbook: one-time import of the old Excel (2023 … Sep 2026)
// + tools. After the import, every finished month is filled automatically
// from the Reimbursement report when someone downloads the workbook.
//
//   node src/scripts/importExpenses.js                       check: who matched which CRM employee,
//                                                            and CRM vs Excel for the last Excel month
//   node src/scripts/importExpenses.js --apply               import (only years not imported yet)
//   node src/scripts/importExpenses.js --apply --force       re-import (replaces those years!)
//   node src/scripts/importExpenses.js --link "NATIA WULAIA=n.tsulaia@cbs.ge" [--link ...]
//                                                            fix a match (with --apply: saved)
//   node src/scripts/importExpenses.js --reopen 2026-10 [--apply]
//                                                            empty a month so the next download recalculates it
import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import ExpenseRow from "../models/ExpenseRow.js";
import ExpenseMonth from "../models/ExpenseMonth.js";
import { computeMonthAmounts, matchNames } from "../utils/expenses.js";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const FORCE = argv.includes("--force");
const links = [];
argv.forEach((a, i) => { if (a === "--link" && argv[i + 1]) links.push(argv[i + 1]); });
const reopenIdx = argv.indexOf("--reopen");
const REOPEN = reopenIdx >= 0 ? argv[reopenIdx + 1] : null;

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "data/expenses-history.json");

await connectDB();
console.log(APPLY ? "\nAPPLY - writing\n" : "\nCHECK ONLY - nothing is written\n");

// ---- --reopen YYYY-MM ----
if (REOPEN) {
  const m = REOPEN.match(/^(\d{4})-(\d{2})$/);
  if (!m) { console.log("--reopen YYYY-MM"); process.exit(1); }
  const [y, mo] = [+m[1], +m[2]];
  const n = await ExpenseRow.countDocuments({ year: y, [`amounts.${mo - 1}`]: { $ne: null } });
  console.log(`${REOPEN}: ${n} თანამშრომლის თანხა წაიშლება და შემდეგ ჩამოტვირთვაზე თავიდან დაითვლება CRM-იდან`);
  if (APPLY) {
    await ExpenseRow.updateMany({ year: y }, { $set: { [`amounts.${mo - 1}`]: null } });
    await ExpenseMonth.deleteOne({ year: y, month: mo });
    console.log("✅ გაიხსნა");
  }
  await mongoose.disconnect();
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const employees = await Employee.find({}).select("firstName lastName email isActive").lean();
const byEmail = new Map(employees.filter((e) => e.email).map((e) => [e.email.toLowerCase(), e]));

const allNames = [...new Set(Object.values(data).flatMap((y) => y.rows.map((r) => r.name)))];
const match = matchNames(allNames, employees);
for (const l of links) {
  const [name, email] = l.split("=").map((s) => s.trim());
  const e = byEmail.get((email || "").toLowerCase());
  if (!e) console.log(`❌ --link: ${email} ვერ მოიძებნა`);
  else match.set(name, { employee: e, how: "manual" });
}

// ---- matching report (current year's people matter most) ----
const years = Object.keys(data).map(Number).sort();
const lastYear = years[years.length - 1];
const lastRows = data[lastYear].rows;
console.log(`${lastYear} (${lastRows.length} ხაზი) — ვინ რომელ CRM თანამშრომელს დაუკავშირდა:`);
const bad = [];
for (const r of lastRows) {
  const mm = match.get(r.name);
  if (mm.employee) {
    if (mm.how !== "name") console.log(`   ~ ${r.name.padEnd(24)} → ${mm.employee.firstName} ${mm.employee.lastName} <${mm.employee.email || "-"}>  (${mm.how === "manual" ? "ხელით" : "გვარით"})`);
  } else bad.push(`${r.name}  (${mm.how === "not found" ? "ვერ მოიძებნა" : mm.how})`);
}
const okCount = lastRows.length - bad.length;
console.log(`   ✅ ${okCount} დაკავშირდა`);
if (bad.length) {
  console.log(`   ❌ ${bad.length} ვერ დაკავშირდა (მათ ახალი თვე ავტომატურად ვერ შეევსებათ):`);
  bad.forEach((b) => console.log(`      - ${b}`));
  console.log('      გასასწორებლად: --link "სახელი ექსელიდან=email@CRM"');
}

// ---- CRM vs Excel for the last month in the Excel (to see the numbers agree) ----
const lastClosed = Math.max(...data[lastYear].closed);
const crm = await computeMonthAmounts(lastYear, lastClosed);
let same = 0, diff = [];
for (const r of lastRows) {
  const mm = match.get(r.name);
  if (!mm.employee) continue;
  const xl = r.amounts[lastClosed - 1];
  const c = crm.get(String(mm.employee._id));
  if (xl == null && c == null) continue;
  if (Math.abs((xl || 0) - (c || 0)) < 0.01) same++;
  else diff.push(`${r.name.padEnd(24)} Excel ${String(xl ?? "-").padStart(6)}   CRM ${String(c ?? "-").padStart(6)}`);
}
console.log(`\nშემოწმება ${lastYear}-${String(lastClosed).padStart(2, "0")}: Excel = CRM ${same} ადამიანთან` + (diff.length ? `, განსხვავდება ${diff.length}:` : " ✅"));
diff.slice(0, 40).forEach((d) => console.log(`   ${d}`));

// ---- import ----
const existing = new Set(await ExpenseRow.distinct("year"));
let wrote = 0;
for (const y of years) {
  if (existing.has(y) && !FORCE) { console.log(`\nℹ️  ${y} უკვე იმპორტირებულია (ხელახლა: --force)`); continue; }
  const rows = data[y].rows.map((r, i) => ({
    year: y, order: i + 1, name: r.name, region: r.region || "", left: !!r.left,
    employee: match.get(r.name)?.employee?._id || null, amounts: r.amounts,
  }));
  console.log(`\n${y}: ${rows.length} ხაზი, შევსებული თვეები: ${data[y].closed.join(", ")}`);
  if (!APPLY) continue;
  await ExpenseRow.deleteMany({ year: y });
  await ExpenseMonth.deleteMany({ year: y });
  await ExpenseRow.insertMany(rows);
  await ExpenseMonth.insertMany(data[y].closed.map((m) => ({ year: y, month: m, source: "excel" })));
  wrote++;
}
// manual links also update rows already imported
if (APPLY && links.length) {
  for (const l of links) {
    const name = l.split("=")[0].trim();
    const e = match.get(name)?.employee;
    if (e) await ExpenseRow.updateMany({ name }, { $set: { employee: e._id } });
  }
  console.log(`\n✅ --link შენახულია`);
}
console.log(APPLY ? `\n✅ ჩაიწერა ${wrote} წელი. შემდეგი ჩამოტვირთვისას დასრულებული თვეები (ოქტომბერი…) CRM-იდან შეივსება.` : "\nყველაფერი სწორია? გაუშვი --apply-ით");
await mongoose.disconnect();
