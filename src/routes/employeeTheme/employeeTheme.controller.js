import Employee from "../../models/Employee.js";
import Section from "../../models/Section.js";
import Group from "../../models/Group.js";

// extracts a division number (1/2/3) from a Section name, handling both
// naming styles found in real data: "1 DIVIZION"/"2 DIVIZION"/"3 DIVIZION"
// and "DIVISION I FUND"/"DIVISION II FUND"/"DIVISION III FUND"
function getDivisionNumber(name) {
  if (!name) return null;
  const upper = name.toUpperCase();
  if (upper.includes("III")) return 3;
  if (upper.includes("II")) return 2;
  if (upper.includes("3")) return 3;
  if (upper.includes("2")) return 2;
  if (upper.includes("1")) return 1;
  if (/\bI\b/.test(upper)) return 1;
  return null;
}

async function resolveSectionName(employee) {
  // 1. employee is the head of a Section directly
  const headedSection = await Section.findOne({ head: employee._id }).select("name");
  if (headedSection) return headedSection.name;

  // 2. figure out which group is relevant: one they head, or one they're a member of
  let groupId = null;

  const headedGroup = await Group.findOne({ head: employee._id }).select("_id section");
  if (headedGroup) {
    groupId = headedGroup._id;
    if (headedGroup.section) {
      const sec = await Section.findById(headedGroup.section).select("name");
      if (sec) return sec.name;
    }
  } else if (employee.group) {
    groupId = employee.group;
    const memberGroup = await Group.findById(employee.group).select("section");
    if (memberGroup?.section) {
      const sec = await Section.findById(memberGroup.section).select("name");
      if (sec) return sec.name;
    }
  }

  // 3. fallback: Group.section wasn't set, but this group might still be
  // listed in some Section's own "groups" array (the two links aren't
  // auto-synced with each other)
  if (groupId) {
    const containingSection = await Section.findOne({ groups: groupId }).select("name");
    if (containingSection) return containingSection.name;
  }

  return null;
}

const WAREHOUSE_POSITIONS = ["Warehouse Manager", "Warehouse Head"];

// GET /api/employees/me/theme — resolves this employee's sidebar theme:
// which color scheme + label to show, based on Position and (for
// division-level staff) which Section their group belongs to
export async function getMyTheme(req, res) {
  try {
    // requireAuth only populates .role on req.employee, not .designation —
    // fetch it fresh here so position is actually available
    const employee = await Employee.findById(req.employee._id).populate(
      "designation",
      "position"
    );
    const position = employee.designation?.position || null;

    let scheme = "office";
    let label = position || "თანამშრომელი";
    let divisionNumber = null;

    // hardcoded for this specific account — same physical person does both
    // Office Manager duties and development on this system
    if (employee.email?.toLowerCase() === "lbogveradze12@gmail.com") {
      scheme = "gold";
      label = "Office Manager | Developer";
    } else if (position === "Admin") {
      scheme = "gold";
      label = "Developer";
    } else if (position === "Director") {
      scheme = "gold";
      label = "Director";
    } else if (position === "Finance Manager") {
      scheme = "gold";
      label = "Finance Manager";
    } else if (WAREHOUSE_POSITIONS.includes(position)) {
      scheme = "warehouse";
      label = position;
    } else {
      const sectionName = await resolveSectionName(employee);
      divisionNumber = getDivisionNumber(sectionName);
      if (divisionNumber) {
        scheme = `division${divisionNumber}`;
      } else {
        scheme = "office";
      }
    }

    res.json({ scheme, label, divisionNumber, position });
  } catch (err) {
    console.error("getMyTheme failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
