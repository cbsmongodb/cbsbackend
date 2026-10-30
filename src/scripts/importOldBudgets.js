// Import budgets exported from the old CRM (global.cbs.ge/en/emp/budgets).
//   node src/scripts/importOldBudgets.js ~/Downloads/budgets_2026.json            (check only)
//   node src/scripts/importOldBudgets.js ~/Downloads/budgets_2026.json --apply    (write)
// Matching: employee by name, doctor by personal ID (Doctor ID), then by name.
// Re-running is safe: a budget with the same old id (or the same employee +
// doctor + date + paid amount) is skipped. After --apply the "issued budget"
// on prescription entry is filled from these budgets (empty ones only).
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Budget from "../models/Budget.js";
import Employee from "../models/Employee.js";
import Doctor from "../models/Doctor.js";
import Group from "../models/Group.js";
import { syncIssuedBudget } from "../utils/budgetSync.js";

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith(".json"));
const APPLY = args.includes("--apply");
if (!file || !fs.existsSync(file)) {
  console.error("Usage: node src/scripts/importOldBudgets.js <budgets.json> [--apply]");
  process.exit(1);
}

const strip = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const amount = (s) => {
  const t = strip(s).replace(/,/g, "");
  const neg = /^\(.*\)$/.test(t);
  const n = parseFloat(t.replace(/[()]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
};
const norm = (s) => String(s || "").toLowerCase()
  .replace(/x/g, "kh").replace(/w/g, "ts").replace(/q/g, "k").replace(/c/g, "ts").replace(/y/g, "k")
  .replace(/[^a-zა-ჿ0-9]/g, "");
const idKey = (s) => strip(s).replace(/\D/g, "").replace(/^0+/, "");
// old CRM shows DD/MM/YYYY; stored as noon Tbilisi so the month never shifts
const parseDate = (s) => {
  const m = strip(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 8)) : null;
};
const ymd = (d) => d.toISOString().slice(0, 10);

const data = JSON.parse(fs.readFileSync(file, "utf8"));
const cols = (data.columns || []).map((c) => c.title);
const ix = (title) => {
  const i = cols.findIndex((t) => t.toLowerCase() === title.toLowerCase());
  if (i < 0) throw new Error(`column "${title}" not found in the file`);
  return i;
};
const C = {
  date: ix("Date"), doctor: ix("Doctor"), doctorId: ix("Doctor ID"), employee: ix("Employee"),
  payable: ix("Payable Amount"), paid: ix("Paid Amount"), target: ix("Target Amount"),
  rx: ix("Prescription Amount"), sales: ix("Sales Amount"), action: ix("Action"), status: ix("Status"),
};

// unique rows by the old budget id (paging in the old CRM can repeat rows)
const byOld = new Map();
for (const r of data.rows || []) {
  const m = String(r[C.action] || "").match(/\/budgets\/(\d+)/);
  const oldId = m ? m[1] : `${r[C.date]}|${r[C.doctorId]}|${r[C.employee]}|${strip(r[C.paid])}`;
  byOld.set(oldId, { oldId, r });
}
console.log(`\nFile: ${data.rows?.length || 0} rows, ${byOld.size} unique budgets (old CRM said ${data.total})${data.failed?.length ? `, ${data.failed.length} pages failed!` : ""}`);
console.log(`Filter in the old CRM: ${data.params?.from_date || "?"} – ${data.params?.to_date || "?"}`);
console.log(`Mode: ${APPLY ? "APPLY — writing" : "CHECK ONLY — nothing is written"}`);

await connectDB();

const empMap = new Map();
for (const e of await Employee.find({}, { firstName: 1, lastName: 1, group: 1 }).lean()) {
  empMap.set(norm(`${e.firstName} ${e.lastName}`), e);
  empMap.set(norm(`${e.lastName} ${e.firstName}`), e);
}
const docById = new Map();
const docByName = new Map();
for (const d of await Doctor.find({}, { firstName: 1, lastName: 1, uniqueNumber: 1 }).lean()) {
  if (d.uniqueNumber) docById.set(idKey(d.uniqueNumber), d);
  const k = norm(`${d.firstName} ${d.lastName}`);
  docByName.set(k, docByName.has(k) ? null : d); // null = ambiguous name
}
const groups = new Map((await Group.find({}, { region: 1, section: 1 }).lean()).map((g) => [String(g._id), g]));

// what is already in the new system
const existing = await Budget.find({}, { employee: 1, doctor: 1, date: 1, paidAmount: 1, oldId: 1 }).lean();
const seen = new Set(existing.map((b) => `${b.employee}|${b.doctor}|${b.date ? ymd(b.date) : ""}|${b.paidAmount}`));
const seenOld = new Set(existing.map((b) => b.oldId).filter(Boolean).map(String));

const missEmp = new Map(), missDoc = new Map();
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const ready = [];
let skipped = 0, noDate = 0, byName = 0, paidSum = 0;
const byMonth = new Map();

for (const { oldId, r } of byOld.values()) {
  const date = parseDate(r[C.date]);
  if (!date) { noDate++; continue; }
  const emp = empMap.get(norm(strip(r[C.employee])));
  if (!emp) { bump(missEmp, strip(r[C.employee])); continue; }
  let doc = docById.get(idKey(r[C.doctorId]));
  if (!doc) {
    doc = docByName.get(norm(strip(r[C.doctor])));
    if (doc) byName++;
  }
  if (!doc) { bump(missDoc, `${strip(r[C.doctor])} (${strip(r[C.doctorId])})`); continue; }
  const paid = amount(r[C.paid]);
  const key = `${emp._id}|${doc._id}|${ymd(date)}|${paid}`;
  if (seenOld.has(oldId) || seen.has(key)) { skipped++; continue; }
  seen.add(key);
  const g = emp.group ? groups.get(String(emp.group)) : null;
  ready.push({
    oldId, employee: emp._id, doctor: doc._id, date,
    isActive: !/is_active%5D=true/.test(String(r[C.status] || "")), // "Activate" link = it is inactive
    paidAmount: paid, payableAmt: amount(r[C.payable]), targetAmount: amount(r[C.target]),
    prescriptionAmt: amount(r[C.rx]), salesAmount: amount(r[C.sales]),
    group: g?._id || null, section: g?.section || null, region: g?.region || null,
  });
  paidSum += paid;
  const mo = ymd(date).slice(0, 7);
  const v = byMonth.get(mo) || { n: 0, paid: 0 };
  v.n++; v.paid += paid; byMonth.set(mo, v);
}

console.log(`\n=== RESULT ===`);
console.log(`Will be imported: ${ready.length}   (paid total ${Math.round(paidSum).toLocaleString("en-US")} ₾)`);
console.log(`Already in the new system — skipped: ${skipped}`);
if (byName) console.log(`Doctor found by NAME (ID did not match): ${byName}`);
if (noDate) console.log(`No date — skipped: ${noDate}`);
console.log(`\nBy month      budgets   paid ₾`);
[...byMonth].sort().forEach(([m, v]) => console.log(`  ${m}      ${String(v.n).padStart(5)}   ${Math.round(v.paid).toLocaleString("en-US").padStart(9)}`));
const show = (t, m) => { if (m.size) { console.log(`\n${t} (${m.size}):`); [...m].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n}× ${k}`)); } };
show("Employees NOT found (their budgets are skipped)", missEmp);
show("Doctors NOT found by ID or name (their budgets are skipped)", missDoc);

if (!APPLY) {
  console.log("\nCHECK ONLY — nothing written. Re-run with --apply to import.");
} else if (ready.length) {
  const saved = await Budget.insertMany(ready, { ordered: false });
  await Doctor.updateMany({ _id: { $in: [...new Set(ready.map((b) => String(b.doctor)))] } }, { isBudgeted: true });
  const pairs = new Map();
  saved.forEach((b) => pairs.set(`${b.employee}|${b.doctor}|${ymd(b.date).slice(0, 7)}`, b));
  for (const b of pairs.values()) {
    try { await syncIssuedBudget(b.employee, b.doctor, b.date); } catch (e) { console.error("sync failed:", e.message); }
  }
  console.log(`\nDONE — imported ${saved.length} budgets; issued budget filled for ${pairs.size} employee+doctor+month.`);
}
await mongoose.disconnect();
