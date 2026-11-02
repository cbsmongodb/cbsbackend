// Active employees grouped by division (Section): first name, last name,
// email, group, position, role. One Excel sheet per division, saved to
// the Desktop. Read-only - changes nothing in the database.
//   node src/scripts/exportDivisionEmployees.js
//   node src/scripts/exportDivisionEmployees.js --all     (inactive too)
import "dotenv/config";
import os from "os";
import path from "path";
import mongoose from "mongoose";
import ExcelJS from "exceljs";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";
import "../models/Role.js";
import "../models/Designation.js";

const ALL = process.argv.includes("--all");
const NO_DIV = "No division";

await connectDB();
const [sections, groups, emps] = await Promise.all([
  Section.find({}).select("name head groups").lean(),
  Group.find({}).select("name head section members").lean(),
  Employee.find(ALL ? {} : { isActive: true })
    .select("firstName lastName email group isActive role designation")
    .populate("role", "name")
    .populate("designation", "position")
    .lean(),
]);

const sectionById = new Map(sections.map((s) => [String(s._id), s]));
const groupById = new Map(groups.map((g) => [String(g._id), g]));
// a group's division: Group.section, or the Section whose groups[] lists it
const sectionOfGroup = (g) => {
  if (!g) return null;
  if (g.section && sectionById.has(String(g.section))) return sectionById.get(String(g.section));
  return sections.find((s) => (s.groups || []).some((id) => String(id) === String(g._id))) || null;
};
const headedSection = new Map(sections.filter((s) => s.head).map((s) => [String(s.head), s]));
const headedGroup = new Map(groups.filter((g) => g.head).map((g) => [String(g.head), g]));
const memberGroup = new Map();
groups.forEach((g) => (g.members || []).forEach((m) => memberGroup.set(String(m), g)));

const byDivision = new Map();
for (const e of emps) {
  const id = String(e._id);
  const group = groupById.get(String(e.group)) || headedGroup.get(id) || memberGroup.get(id) || null;
  const section = headedSection.get(id) || sectionOfGroup(group);
  const div = section?.name || NO_DIV;
  if (!byDivision.has(div)) byDivision.set(div, []);
  byDivision.get(div).push({
    firstName: e.firstName || "",
    lastName: e.lastName || "",
    email: e.email || "",
    group: group?.name || "",
    position: e.designation?.position || "",
    role: e.role?.name || "",
    note: headedSection.has(id) ? "Division head" : headedGroup.has(id) ? "Group head" : "",
    active: e.isActive ? "yes" : "no",
  });
}

const wb = new ExcelJS.Workbook();
const names = [...byDivision.keys()].sort((a, b) => (a === NO_DIV) - (b === NO_DIV) || a.localeCompare(b));
const used = new Set();
for (const div of names) {
  const rows = byDivision.get(div).sort((a, b) =>
    a.group.localeCompare(b.group) || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  // Excel sheet names: max 31 chars, no : \ / ? * [ ]
  let sheet = div.replace(/[:\\/?*[\]]/g, " ").slice(0, 31).trim() || "Sheet";
  while (used.has(sheet)) sheet = (sheet.slice(0, 28) + " " + used.size).trim();
  used.add(sheet);
  const ws = wb.addWorksheet(sheet);
  ws.columns = [
    { header: "First name", key: "firstName", width: 18 },
    { header: "Last name", key: "lastName", width: 22 },
    { header: "Email", key: "email", width: 34 },
    { header: "Group", key: "group", width: 24 },
    { header: "Position", key: "position", width: 24 },
    { header: "Role", key: "role", width: 22 },
    { header: "Note", key: "note", width: 14 },
    ...(ALL ? [{ header: "Active", key: "active", width: 8 }] : []),
  ];
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: "A1", to: { row: 1, column: ws.columns.length } };
  console.log(`${div}: ${rows.length}`);
}

const out = path.join(os.homedir(), "Desktop", "employees-by-division.xlsx");
await wb.xlsx.writeFile(out);
console.log(`\n✅ saved: ${out}`);
await mongoose.disconnect();
