// One-off migration — links every real Group to the Section (real
// division) it actually belongs to. Neither seedGroups.js nor
// seedSections.js ever set Group.section or Section.groups[], so today
// this link is completely empty — which means Section-based scoping
// (getVisibleGroups/getVisibleEmployeeIds) sees nothing for the 3
// division heads, and the employeeTheme fallback chain can't resolve a
// division number for anyone who isn't a Section head themselves.
//
// Mapping below is built by cross-referencing setEmployeeDivisionsGroups.js
// (which group belongs to which Division) against seedGroups.js's actual
// group list — every group is accounted for explicitly, nothing inferred
// by regex, to keep this auditable. "Test" (samegrelo, a dev/test group)
// is intentionally left unmapped — it isn't part of any real division.
//
// Safe to re-run: skips a link that's already correctly set on both sides.
//
// Usage:
//   node src/scripts/linkGroupsToSections.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";

const GROUP_TO_SECTION = [
  // Division 1 — "1 DIVIZION"
  ["P1", "1 DIVIZION"],
  ["P2", "1 DIVIZION"],
  ["P3", "1 DIVIZION"],
  ["P - REGIONS", "1 DIVIZION"],
  ["Virt. Regional Manager Division 1", "1 DIVIZION"],
  ["DIVISION I FUND", "1 DIVIZION"],

  // Division 2 — "2 DIVIZION"
  ["M1", "2 DIVIZION"],
  ["M2", "2 DIVIZION"],
  ["M3", "2 DIVIZION"],
  ["M-REGIONS", "2 DIVIZION"],
  ["M REGIONAL MANAGER", "2 DIVIZION"],
  ["DIVISION II FUND", "2 DIVIZION"],

  // Division 3 — "3 DIVIZION"
  ["H1", "3 DIVIZION"],
  ["H2", "3 DIVIZION"],
  ["H3", "3 DIVIZION"],
  ["H- REGIONS", "3 DIVIZION"],
  ["DIVISION III FUND", "3 DIVIZION"],

  // "Test" (samegrelo) intentionally left unmapped — not a real division.
];

async function run() {
  await connectDB();

  let linked = 0;
  let alreadyLinked = 0;
  let groupNotFound = 0;
  let sectionNotFound = 0;

  for (const [groupName, sectionName] of GROUP_TO_SECTION) {
    const group = await Group.findOne({ name: groupName });
    if (!group) {
      console.log(`  Warning: no Group found named "${groupName}"`);
      groupNotFound++;
      continue;
    }

    const section = await Section.findOne({ name: sectionName });
    if (!section) {
      console.log(`  Warning: no Section found named "${sectionName}"`);
      sectionNotFound++;
      continue;
    }

    const groupSideOk = String(group.section || "") === String(section._id);
    const sectionSideOk = section.groups.some((g) => String(g) === String(group._id));

    if (groupSideOk && sectionSideOk) {
      alreadyLinked++;
      continue;
    }

    if (!groupSideOk) {
      group.section = section._id;
      await group.save();
    }
    if (!sectionSideOk) {
      section.groups.push(group._id);
      await section.save();
    }

    linked++;
    console.log(`Linked: ${groupName} -> ${sectionName}`);
  }

  console.log(
    `\nDone. Linked: ${linked}, already linked: ${alreadyLinked}, ` +
      `group not found: ${groupNotFound}, section not found: ${sectionNotFound}`
  );

  // sanity check — print each Section's resulting group count
  const sections = await Section.find().select("name groups");
  console.log("\nSection group counts:");
  for (const s of sections) {
    console.log(`  ${s.name}: ${s.groups.length} group(s)`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
