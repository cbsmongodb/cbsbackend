// Tamuna Jinjolava must see her division exactly like Rusudan Abzianidze sees hers.
// Compares the two side by side and (with --apply) copies the missing setup to Tamuna.
//   node src/scripts/compareDivisionManagers.js            (check only, writes nothing)
//   node src/scripts/compareDivisionManagers.js --apply    (fixes Tamuna)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Role from "../models/Role.js";
import Section from "../models/Section.js";
import Group from "../models/Group.js";
import { getVisibleGroups, getVisibleEmployeeIds, getVisibleDrugIds } from "../utils/groupVisibility.js";

const APPLY = process.argv.includes("--apply");
const MODEL = { first: /^rusudan$/i, last: /^abzianidze$/i };   // the one that works
const TARGET = { first: /^tamuna$/i, last: /^jinjolava$/i };    // the one to fix
const TARGET_DIVISION = /^\s*1\s*DIVIZION\s*$/i;                 // Tamuna's division

const on = (p) => Object.entries(p || {}).filter(([, v]) => v === 1).map(([k]) => k);
const privs = (role) => {
  const m = role?.privileges instanceof Map ? Object.fromEntries(role.privileges) : role?.privileges || {};
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, on(v?.toObject ? v.toObject() : v)]).filter(([, a]) => a.length));
};

async function load(who) {
  const e = await Employee.findOne({ firstName: who.first, lastName: who.last }).populate("role");
  if (!e) return null;
  const group = e.group ? await Group.findById(e.group).populate("section", "name").lean() : null;
  const headed = await Section.find({ head: e._id }).select("name groups").lean();
  const groups = await getVisibleGroups(e);
  const people = await getVisibleEmployeeIds(e);
  const drugs = await getVisibleDrugIds(e);
  return { e, group, headed, groups, people, drugs };
}

function show(label, x) {
  console.log(`\n=== ${label}: ${x.e.firstName} ${x.e.lastName} <${x.e.email}>  active: ${x.e.isActive !== false}`);
  console.log(`   role:        ${x.e.role?.name || "—"}`);
  console.log(`   own group:   ${x.group?.name || "—"}   (division: ${x.group?.section?.name || "—"})`);
  console.log(`   head of:     ${x.headed.map((s) => `${s.name} (${(s.groups || []).length} groups)`).join(", ") || "— nothing"}`);
  console.log(`   sees:        ${x.groups.length} groups · ${x.people.length} people · ${x.drugs.length} drugs`);
  console.log(`   pages:       ${Object.keys(privs(x.e.role)).sort().join(", ") || "—"}`);
}

await connectDB();
const model = await load(MODEL);
const target = await load(TARGET);
if (!model || !target) {
  console.log(`❌ not found: ${!model ? "Rusudan Abzianidze " : ""}${!target ? "Tamuna Jinjolava" : ""}`);
  await mongoose.disconnect(); process.exit(1);
}
show("WORKS ", model);
show("TO FIX", target);

const fixes = [];

// 1) same role (that decides the pages / buttons she sees)
if (String(target.e.role?._id) !== String(model.e.role?._id)) {
  const mine = privs(target.e.role), theirs = privs(model.e.role);
  const missing = Object.keys(theirs).filter((k) => !mine[k] || theirs[k].some((a) => !mine[k].includes(a)));
  console.log(`\n❌ role differs: "${target.e.role?.name}" vs "${model.e.role?.name}"`);
  console.log(`   missing pages/rights: ${missing.join(", ") || "—"}`);
  fixes.push(["role", model.e.role]);
} else console.log("\n✅ same role");

// 2) head of her own division (that decides WHOSE data she sees)
if (model.headed.length && !target.headed.length) {
  const div = (await Section.findOne({ name: TARGET_DIVISION })) ||
    (target.group?.section ? await Section.findById(target.group.section._id) : null);
  if (!div) console.log("❌ she leads no division and '1 DIVIZION' wasn't found — check the Sections page");
  else {
    const cur = div.head ? await Employee.findById(div.head).select("firstName lastName isActive").lean() : null;
    console.log(`❌ not head of any division — ${div.name} head now: ${cur ? `${cur.firstName} ${cur.lastName}${cur.isActive === false ? " (inactive)" : ""}` : "nobody"}`);
    if (cur && cur.isActive !== false && String(cur._id) !== String(target.e._id)) {
      console.log(`   ⚠️  ${cur.firstName} ${cur.lastName} is active — not replaced automatically. Tell Claude.`);
    } else fixes.push(["head", div]);
  }
} else if (target.headed.length) console.log(`✅ head of ${target.headed.map((s) => s.name).join(", ")}`);

// 3) her division really has groups attached (otherwise she sees nobody)
for (const s of target.headed) {
  const linked = await Group.countDocuments({ section: s._id });
  if (!(s.groups || []).length && !linked) console.log(`❌ ${s.name} has NO groups attached — open Groups and set their Section to ${s.name}`);
}

if (!fixes.length) {
  console.log(target.groups.length ? "\nNothing to change here. If a specific page still looks empty, tell Claude which one." : "\n⚠️  setup looks right but she sees 0 groups — send this output to Claude.");
  await mongoose.disconnect(); process.exit(0);
}
if (!APPLY) { console.log("\n(check only — run again with --apply to fix)"); await mongoose.disconnect(); process.exit(0); }

for (const [kind, v] of fixes) {
  if (kind === "role") { await Employee.updateOne({ _id: target.e._id }, { $set: { role: v._id } }); console.log(`\n✅ role -> ${v.name}`); }
  if (kind === "head") { v.head = target.e._id; await v.save(); console.log(`✅ head of ${v.name}`); }
}
const after = await load(TARGET);
console.log(`\nnow she sees: ${after.groups.length} groups · ${after.people.length} people · ${after.drugs.length} drugs`);
console.log("She must log out and log in again (changes reach the server within a minute).");
await mongoose.disconnect();
