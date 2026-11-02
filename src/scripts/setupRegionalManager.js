// Regional manager: sees the chosen reps (Live Feed, team status, reports)
// and has everything a Representative has.
//
// 1) list the division's people (nothing changes):
//    node src/scripts/setupRegionalManager.js "Nana Nakaidze"
// 2) check what would change:
//    node src/scripts/setupRegionalManager.js "Nana Nakaidze" --group "M REGIONAL MANAGER" --people "Karalashvili,Natchkebia"
// 3) do it:  ...same... --apply
//
// What --apply does:
//   - the manager becomes HEAD of --group, the people are added to its members[]
//     (their own group stays the same - they are only made visible to the manager)
//   - the manager's ROLE gets every permission the "Representative" role has,
//     plus Live Feed / Field Team Status (attendances: read)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";
import Role from "../models/Role.js";
import "../models/Region.js";

const args = process.argv.slice(2);
const who = args[0];
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes("--apply");
const groupName = opt("--group");
const people = (opt("--people") || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!who) {
  console.error('Usage: node src/scripts/setupRegionalManager.js "Name Surname or email" [--group "Group"] [--people "Surname1,Surname2"] [--apply]');
  process.exit(1);
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const full = (e) => `${e.firstName || ""} ${e.lastName || ""}`.trim();

await connectDB();

// --- manager
let mgr;
if (who.includes("@")) mgr = await Employee.findOne({ email: who.toLowerCase().trim() }).populate("role").lean();
else {
  const [f, ...l] = who.trim().split(/\s+/);
  mgr = await Employee.findOne({ firstName: new RegExp(`^${esc(f)}$`, "i"), lastName: new RegExp(`^${esc(l.join(" "))}$`, "i") }).populate("role").lean();
}
if (!mgr) { console.error("Manager not found:", who); await mongoose.disconnect(); process.exit(1); }

const [sections, groups] = await Promise.all([
  Section.find({}).select("name groups").lean(),
  Group.find({}).select("name head section members region drugs").populate("region", "name").lean(),
]);
const sectionOf = (g) =>
  sections.find((s) => String(s._id) === String(g?.section)) ||
  sections.find((s) => (s.groups || []).some((id) => String(id) === String(g?._id)));
const mgrGroup = groups.find((g) => String(g._id) === String(mgr.group));
const division = sectionOf(mgrGroup);
console.log(`\n👤 ${full(mgr)} — role: ${mgr.role?.name || "—"}, group: ${mgrGroup?.name || "—"}, division: ${division?.name || "—"}`);

// --- step 1: list the division
if (!groupName && !people.length) {
  if (!division) console.log("⚠️  manager has no division (no group) — showing everyone");
  const inDiv = groups.filter((g) => !division || String(sectionOf(g)?._id) === String(division._id));
  const emps = await Employee.find({ isActive: true, group: { $in: inDiv.map((g) => g._id) } })
    .select("firstName lastName email group").populate("role", "name").lean();
  for (const g of inDiv) {
    const list = emps.filter((e) => String(e.group) === String(g._id));
    if (!list.length) continue;
    console.log(`\n📁 ${g.name}  (region: ${g.region?.name || "—"})`);
    list.sort((a, b) => full(a).localeCompare(full(b)))
      .forEach((e) => console.log(`   - ${full(e).padEnd(28)} ${e.email.padEnd(32)} ${e.role?.name || ""}`));
  }
  console.log('\nNext: run again with --group "<group for the manager>" --people "Surname1,Surname2,..."');
  await mongoose.disconnect();
  process.exit(0);
}

// --- step 2/3
const group = groups.find((g) => g.name.toLowerCase().trim() === String(groupName || "").toLowerCase().trim());
if (!group) { console.error(`\n⚠️  group "${groupName}" not found`); await mongoose.disconnect(); process.exit(1); }

const found = [];
let problems = 0;
for (const p of people) {
  const q = p.includes("@")
    ? { email: p.toLowerCase() }
    : { $or: [{ lastName: new RegExp(esc(p), "i") }, { firstName: new RegExp(esc(p), "i") }] };
  const m = await Employee.find({ ...q, isActive: true }).select("firstName lastName email").lean();
  if (m.length === 1) found.push(m[0]);
  else {
    problems++;
    console.log(`   ⚠️  "${p}": ${m.length ? `${m.length} matches — use the email instead:` : "not found"}`);
    m.forEach((e) => console.log(`        ${full(e)}  ${e.email}`));
  }
}

const rep = (await Role.find({})).find((r) => ["representative", "წარმომადგენელი"].includes(r.name.toLowerCase().trim()));
const mgrRole = await Role.findById(mgr.role?._id);

console.log(`\n🎯 plan:`);
if (String(group.head || "") !== String(mgr._id)) console.log(`   • ${full(mgr)} becomes head of "${group.name}"${group.head ? " (replaces the current head)" : ""}`);
found.forEach((e) => console.log(`   • ${full(e)} → visible to ${full(mgr)} (added to "${group.name}" members)`));
console.log(rep ? `   • role "${mgrRole?.name}" gets all "${rep.name}" permissions + Live Feed / Team Status` : '   ⚠️  "Representative" role not found — permissions not changed');
if (mgrRole) {
  const n = await Employee.countDocuments({ role: mgrRole._id, isActive: true });
  if (n > 1) console.log(`     (role "${mgrRole.name}" has ${n} people — all of them get these permissions)`);
}
if ((group.drugs || []).length)
  console.log(`   ⚠️  "${group.name}" has ${group.drugs.length} drug(s) — added people would also see them in their drug lists`);
if (problems) console.log("\n⚠️  fix the names above first (nothing changed)");

if (APPLY && !problems) {
  await Group.updateOne(
    { _id: group._id },
    { $set: { head: mgr._id }, $addToSet: { members: { $each: found.map((e) => e._id) } } }
  );
  if (rep && mgrRole) {
    const BASE = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };
    const plain = (v) => (v ? (v.toObject ? v.toObject() : { ...v }) : {});
    rep.privileges.forEach((v, key) => {
      const cur = { ...BASE, ...plain(mgrRole.privileges.get(key)) };
      const add = plain(v);
      Object.keys(BASE).forEach((k) => { cur[k] = Math.max(cur[k] || 0, add[k] || 0); });
      mgrRole.privileges.set(key, cur);
    });
    const att = { ...BASE, ...plain(mgrRole.privileges.get("attendances")) };
    att.read = 1;
    att.live_feeds = 1;
    mgrRole.privileges.set("attendances", att);
    mgrRole.markModified("privileges");
    await mgrRole.save();
  }
  console.log(`\n✅ done. ${full(mgr)} should log out and back in (or refresh) to see the new menu.`);
} else if (!problems) {
  console.log("\n(check only — add --apply to do it)");
}
await mongoose.disconnect();
