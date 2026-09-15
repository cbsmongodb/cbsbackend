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

const WAREHOUSE_POSITIONS = ["Warehouse Manager", "Warehouse Head"];

// GET /api/employees/me/theme — resolves this employee's sidebar theme:
// which color scheme + label to show, based on Position and (for
// division-level staff) which Section their group belongs to
export async function getMyTheme(req, res) {
  try {
    // requireAuth only populates .role on req.employee, not .designation —
    // fetch it fresh here so position is actually available
    const employee = await Employee.findById(req.employee._id).populate("designation", "position");
    const position = employee.designation?.position || null;

    let scheme = "office";
    let label = position || "თანამშრომელი";
    let divisionNumber = null;

    if (position === "Admin") {
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
      // resolve division via: section they head -> group they head's section
      // -> group they belong to's section
      let sectionName = null;

      const headedSection = await Section.findOne({ head: employee._id }).select("name");
      if (headedSection) {
        sectionName = headedSection.name;
      } else {
        const headedGroup = await Group.findOne({ head: employee._id }).populate("section", "name");
        if (headedGroup?.section) {
          sectionName = headedGroup.section.name;
        } else if (employee.group) {
          const memberGroup = await Group.findById(employee.group).populate("section", "name");
          if (memberGroup?.section) {
            sectionName = memberGroup.section.name;
          }
        }
      }

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
