// Make someone a full division manager of their division — same pages as the other division managers,
// scoped to their own division.
//   node src/scripts/fixDivisionManager.js jinjolava            (check only — shows what is wrong)
//   node src/scripts/fixDivisionManager.js jinjolava --apply    (fixes it)
// Checks: 1) role = "Division Manager" (that role holds the budgets / reports / ... permissions)
//         2) she is the head of her DIVIZION (that decides WHICH people / data she sees)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Role from "../models/Role.js";
import Section from "../models/Section.js";
import Group from "../models/Group.js";

const q = process.argv.slice(2).find((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!q) { console.log('usage: node src/scripts/fixDivisionManager.js <surname or email> [--apply]'); process.exit(1); }

const on = (p) => Object.entries(p || {}).filter(([, v]) => v === 1).map(([k]) => k);
const privs = (role) => {
  const m = role?.privileges instanceof Map ? Object.fromEntries(role.privileges) : role?.privileges || {};
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, on(v?.toObject ? v.toObject() : v)]).filter(([, a]) => a.length));
};

await connectDB();
const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
const people = await Employee.find({ $or: [{ email: rx }, { lastName: rx }, { firstName: rx }] }).populate("role").lean();
if (people.length !== 1) {
  console.log(people.length ? `more than one match — use the email:` : `nobody matches "${q}"`);
  people.forEach((p) => console.log(`   - ${p.firstName} ${p.lastName}  ${p.email}  (${p.role?.name})`));
  await mongoose.disconnect(); process.exit(1);
}
const e = people[0];
const dmRole = await Role.findOne({ name: /^\s*division manager\s*$/i });
if (!dmRole) { console.log('❌ no "Division Manager" role in the database'); await mongoose.disconnect(); process.exit(1); }

console.log(`\n👤 ${e.firstName} ${e.lastName} <${e.email}>  active: ${e.isActive !== false}`);
console.log(`   role: ${e.role?.name || "—"}`);

// 1) role
let fixes = 0;
const roleOk = String(e.role?._id) === String(dmRole._id);
if (roleOk) console.log('   ✅ role is Division Manager');
else {
  fixes++;
  const mine = privs(e.role), dm = privs(dmRole);
  const missing = Object.keys(dm).filter((k) => !mine[k] || dm[k].some((a) => !mine[k].includes(a)));
  const extra = Object.keys(mine).filter((k) => !dm[k]);
  console.log(`   ❌ role is "${e.role?.name}", not Division Manager`);
  console.log(`      she is missing: ${missing.join(", ") || "—"}`);
  if (extra.length) console.log(`      ⚠️  her current role has things Division Manager doesn't: ${extra.join(", ")}`);
  const others = await Employee.countDocuments({ role: e.role?._id, _id: { $ne: e._id } });
  console.log(`      (${others} other people share her current role — they are NOT changed)`);
}

// 2) division
const headed = await Section.find({ head: e._id }).select("name").lean();
const ownGroup = e.group ? await Group.findById(e.group).populate("section", "name head").lean() : null;
const div = ownGroup?.section || null;
console.log(`   group: ${ownGroup?.name || "—"}   division: ${div?.name || "—"}`);
let target = null;
if (headed.length) console.log(`   ✅ head of: ${headed.map((s) => s.name).join(", ")}`);
else {
  // which division should she lead? her group's division, else one with "1" when the name says so
  target = div ? await Section.findById(div._id) : null;
  if (!target) {
    const all = await Section.find({ name: /DIVIZION/i }).populate("head", "firstName lastName").lean();
    console.log('   ❌ not head of any division and her group has no division. Divisions:');
    all.forEach((s) => console.log(`      - ${s.name}  head: ${s.head ? `${s.head.firstName} ${s.head.lastName}` : "—"}`));
    console.log('      -> set her group / head on the Sections page, or send this to Claude');
  } else {
    fixes++;
    const cur = target.head ? await Employee.findById(target.head).select("firstName lastName isActive").lean() : null;
    console.log(`   ❌ not head of ${target.name} (head now: ${cur ? `${cur.firstName} ${cur.lastName}${cur.isActive === false ? " — inactive" : ""}` : "nobody"})`);
    if (cur && cur.isActive !== false && String(cur._id) !== String(e._id)) {
      console.log(`      ⚠️  ${cur.firstName} ${cur.lastName} is still active and head — not replaced automatically. Tell Claude who leads ${target.name}.`);
      target = null; fixes--;
    }
  }
}

if (!fixes) { console.log('\nNothing to fix here. If she still can\'t see a page, tell Claude which one.'); await mongoose.disconnect(); process.exit(0); }
if (!APPLY) { console.log('\n(check only — run again with --apply to fix)'); await mongoose.disconnect(); process.exit(0); }

if (!roleOk) { await Employee.updateOne({ _id: e._id }, { $set: { role: dmRole._id } }); console.log('\n✅ role -> Division Manager'); }
if (target) { target.head = e._id; await target.save(); console.log(`✅ head of ${target.name}`); }
console.log('\nShe must log out and log in again. Changes reach the server within a minute.');
await mongoose.disconnect();
