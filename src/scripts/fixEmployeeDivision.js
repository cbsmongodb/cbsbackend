// Why does a division's manager see someone from another division? And fix it.
//   node src/scripts/fixEmployeeDivision.js "natiabadridze@gmail.com"            (check only)
//   node src/scripts/fixEmployeeDivision.js "natiabadridze@gmail.com" --apply    (fix)
// Fix = the person's own group belongs ONLY to its own division:
//   - Group.section points to the division in the group's / person's name
//   - the group is removed from other divisions' Section.groups[]
//   - the person is removed from members[] of groups in other divisions
// Being head of a group / division elsewhere is only reported, never changed.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";
import "../models/Role.js";

const who = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!who) {
  console.error('Usage: node src/scripts/fixEmployeeDivision.js "email" [--apply]');
  process.exit(1);
}

function divNo(name) {
  const u = String(name || "").toUpperCase();
  if (u.includes("III") || /\b3\b|3 DIV/.test(u)) return 3;
  if (u.includes("II") || /\b2\b|2 DIV/.test(u)) return 2;
  if (/\bI\b/.test(u) || /\b1\b|1 DIV/.test(u)) return 1;
  return null;
}

await connectDB();
const emp = await Employee.findOne({ email: who.toLowerCase().trim() }).populate("role", "name").lean();
if (!emp) {
  console.error("Employee not found:", who);
  await mongoose.disconnect();
  process.exit(1);
}
const name = `${emp.firstName} ${emp.lastName}`.trim();
const [sections, groups] = await Promise.all([
  Section.find({}).select("name head groups").populate("head", "firstName lastName").lean(),
  Group.find({}).select("name head section members").lean(),
]);
const secById = new Map(sections.map((s) => [String(s._id), s]));
const sectionsOfGroup = (g) => {
  const out = new Set();
  if (g.section) out.add(String(g.section));
  sections.forEach((s) => (s.groups || []).some((id) => String(id) === String(g._id)) && out.add(String(s._id)));
  return [...out].map((id) => secById.get(id)).filter(Boolean);
};
const id = String(emp._id);
const own = groups.find((g) => String(g._id) === String(emp.group));

console.log(`\n👤 ${name} — role: ${emp.role?.name || "—"}`);
console.log(`   own group: ${own ? own.name : "— none —"}`);
if (own) console.log(`   that group is in division(s): ${sectionsOfGroup(own).map((s) => s.name).join(", ") || "— none —"}`);

const memberOf = groups.filter((g) => (g.members || []).some((m) => String(m) === id));
const headOf = groups.filter((g) => String(g.head) === id);
const headOfSection = sections.filter((s) => String(s.head?._id || s.head) === id);
memberOf.forEach((g) => console.log(`   listed in members[] of group "${g.name}" → ${sectionsOfGroup(g).map((s) => s.name).join(", ") || "no division"}`));
headOf.forEach((g) => console.log(`   HEAD of group "${g.name}" → ${sectionsOfGroup(g).map((s) => s.name).join(", ") || "no division"}`));
headOfSection.forEach((s) => console.log(`   HEAD of division "${s.name}"`));

// which division heads can see this person, and why
console.log("\n👀 Division managers who see this person:");
for (const s of sections) {
  const gs = groups.filter((g) => sectionsOfGroup(g).some((x) => String(x._id) === String(s._id)));
  const reasons = [];
  gs.forEach((g) => {
    if (String(g._id) === String(emp.group)) reasons.push(`own group "${g.name}" is linked to this division`);
    if ((g.members || []).some((m) => String(m) === id)) reasons.push(`listed in members[] of "${g.name}"`);
    if (String(g.head) === id) reasons.push(`head of "${g.name}"`);
  });
  if (reasons.length) {
    const head = s.head ? `${s.head.firstName || ""} ${s.head.lastName || ""}`.trim() : "no head";
    console.log(`   - ${s.name} (${head}): ${reasons.join("; ")}`);
  }
}

// target division = the one named in the person's group name
const target = own ? sections.filter((s) => divNo(s.name) && divNo(s.name) === divNo(own.name)) : [];
if (!own) {
  console.log("\n⚠️  No own group — set the group on the Employees page first.");
} else if (target.length !== 1) {
  console.log(`\n⚠️  Can't tell which division "${own.name}" belongs to (${target.length} matches) — fix it on the Groups / Sections pages.`);
} else {
  const T = target[0];
  console.log(`\n🎯 "${own.name}" should be only in division: ${T.name}`);
  const plan = [];
  if (String(own.section || "") !== String(T._id)) plan.push(["group.section", `set "${own.name}".section → ${T.name}`]);
  sections.forEach((s) => {
    if (String(s._id) !== String(T._id) && (s.groups || []).some((g) => String(g) === String(own._id)))
      plan.push(["unlink", `remove "${own.name}" from ${s.name}.groups`, s._id]);
  });
  if (!(T.groups || []).some((g) => String(g) === String(own._id))) plan.push(["link", `add "${own.name}" to ${T.name}.groups`]);
  memberOf.forEach((g) => {
    if (String(g._id) !== String(own._id) && !sectionsOfGroup(g).some((x) => String(x._id) === String(T._id)))
      plan.push(["member", `remove ${name} from members[] of "${g.name}"`, g._id]);
  });
  if (!plan.length) console.log("   nothing to fix in links ✅");
  plan.forEach(([, text]) => console.log(`   • ${text}`));
  if (headOf.some((g) => !sectionsOfGroup(g).some((x) => String(x._id) === String(T._id))) || headOfSection.some((s) => String(s._id) !== String(T._id)))
    console.log("   ⚠️  is HEAD of a group/division elsewhere — change that on the Groups / Sections page (not done automatically)");

  if (APPLY && plan.length) {
    for (const [kind, , ref] of plan) {
      if (kind === "group.section") await Group.updateOne({ _id: own._id }, { $set: { section: T._id } });
      if (kind === "unlink") await Section.updateOne({ _id: ref }, { $pull: { groups: own._id } });
      if (kind === "link") await Section.updateOne({ _id: T._id }, { $addToSet: { groups: own._id } });
      if (kind === "member") await Group.updateOne({ _id: ref }, { $pull: { members: emp._id } });
    }
    console.log("\n✅ fixed. Managers see the change within a minute (or after a page refresh).");
  } else if (plan.length) {
    console.log("\n(check only — run again with --apply to fix)");
  }
}
await mongoose.disconnect();
