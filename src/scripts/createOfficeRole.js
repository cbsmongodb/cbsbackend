// Creates role "Office" = exact copy of Accountant's Assistant privileges,
// and gives it to Avinash. Safe to re-run.   node src/scripts/createOfficeRole.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";

await connectDB();
const source = await Role.findOne({ name: /^\s*accountant.s\s+assistant\s*$/i });
if (!source) { console.error("No Accountant's Assistant role found"); process.exit(1); }

let office = await Role.findOne({ name: /^\s*office\s*$/i });
if (!office) office = new Role({ name: "Office" });
office.privileges = new Map(source.privileges);
office.markModified("privileges");
await office.save();
console.log(`Role "${office.name}" = copy of "${source.name}" (${office.privileges.size} permissions)`);

const people = await Employee.find({ $or: [{ firstName: /avinash/i }, { lastName: /avinash/i }] });
if (people.length !== 1) {
  console.log(`Found ${people.length} people named Avinash: ${people.map((p) => `${p.firstName} ${p.lastName} (${p.email})`).join(", ") || "-"}`);
  console.log("Not changed - set the role on the Employees page instead.");
} else {
  people[0].role = office._id;
  await people[0].save();
  console.log(`${people[0].firstName} ${people[0].lastName} (${people[0].email}) -> role "${office.name}"`);
}
await mongoose.disconnect();
