// Which months does someone have prescription lines in? (read-only)
//   node src/scripts/checkEntries.js "email1,email2"
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import DoctorEntryItem from "../models/DoctorEntryItem.js";

const emails = (process.argv[2] || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
if (!emails.length) {
  console.error("Usage: node ... \"email1,email2\"");
  process.exit(1);
}
const t = (d) =>
  new Date(d).toLocaleString("en-GB", { timeZone: "Asia/Tbilisi" });

await connectDB();
for (const email of emails) {
  const e = await Employee.findOne({ email })
    .select("firstName lastName isActive")
    .lean();
  if (!e) {
    console.log("\n? " + email + ": not found");
    continue;
  }
  console.log("\n>> " + e.firstName + " " + e.lastName);
  const rows = await DoctorEntryItem.aggregate([
    { $match: { employee: e._id } },
    {
      $group: {
        _id: "$period",
        lines: { $sum: 1 },
        doctors: { $addToSet: "$doctor" },
        last: { $max: "$updatedAt" },
      },
    },
    { $sort: { _id: -1 } },
    { $limit: 4 },
  ]);
  if (!rows.length) console.log("   no prescription lines at all");
  for (const r of rows) {
    const p = new Date(r._id);
    console.log(
      "   month " + p.toISOString().slice(0, 10) +
        " | doctors " + r.doctors.length +
        " | lines " + r.lines +
        " | last saved " + (r.last ? t(r.last) : "-")
    );
  }
}
await mongoose.disconnect();
