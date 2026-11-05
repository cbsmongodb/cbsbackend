// Give someone the same position (designation) as another person.
//   node src/scripts/fixDesignation.js n.giorgadze@cbs.ge t.gigashvili@cbs.ge          (check)
//   node src/scripts/fixDesignation.js n.giorgadze@cbs.ge t.gigashvili@cbs.ge --apply  (write)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import "../models/Designation.js";

const [who, like] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!who || !like) {
  console.error("Usage: node src/scripts/fixDesignation.js <email> <copy-from-email> [--apply]");
  process.exit(1);
}
await connectDB();
const find = (e) => Employee.findOne({ email: e.toLowerCase().trim() })
  .select("firstName lastName designation").populate("designation", "position").lean();
const [a, b] = await Promise.all([find(who), find(like)]);
if (!a || !b) {
  console.log(`not found: ${!a ? who : like}`);
} else {
  console.log(`${a.firstName} ${a.lastName}: position now "${a.designation?.position || "-"}"`);
  console.log(`   -> "${b.designation?.position || "-"}" (same as ${b.firstName} ${b.lastName})`);
  if (APPLY) {
    await Employee.updateOne({ _id: a._id }, { $set: { designation: b.designation?._id || null } });
    console.log("\n✅ saved - refresh the page in a minute");
  } else {
    console.log("\n(check only - add --apply)");
  }
}
await mongoose.disconnect();
