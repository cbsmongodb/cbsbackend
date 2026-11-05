// Who has which role? Fix one person's role.
//   node src/scripts/fixRole.js                                   (list everyone with a "global" role: admin, director...)
//   node src/scripts/fixRole.js n.giorgadze@cbs.ge                 (show this person's role)
//   node src/scripts/fixRole.js n.giorgadze@cbs.ge "Representative" --apply   (set the role)
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Role from "../models/Role.js";

const [email, roleName] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const GLOBAL = ["admin", "director", "system administrator", "finance manager", "office manager", "office", "accountant's assistant"];

await connectDB();
if (!email) {
  const roles = (await Role.find({}).select("name").lean()).filter((r) => GLOBAL.includes(r.name.toLowerCase().trim()));
  for (const r of roles) {
    const people = await Employee.find({ role: r._id }).select("firstName lastName email isActive").lean();
    console.log(`\n== ${r.name} (${people.length}) - sees EVERYONE`);
    people.forEach((p) => console.log(`   - ${p.firstName} ${p.lastName}  ${p.email}${p.isActive ? "" : "  (inactive)"}`));
  }
  await mongoose.disconnect();
  process.exit(0);
}
const e = await Employee.findOne({ email: email.toLowerCase().trim() }).populate("role", "name").lean();
if (!e) {
  console.log(`not found: ${email}`);
} else {
  console.log(`\n${e.firstName} ${e.lastName} <${e.email}> - role now: ${e.role?.name || "-"}`);
  if (roleName) {
    const r = await Role.findOne({ name: new RegExp(`^\\s*${roleName.trim()}\\s*$`, "i") }).lean();
    if (!r) {
      console.log(`role not found: ${roleName}`);
    } else {
      console.log(`   -> new role: ${r.name}`);
      if (APPLY) {
        await Employee.updateOne({ _id: e._id }, { $set: { role: r._id } });
        console.log("\n✅ saved - she must log out and log in again");
      } else {
        console.log("\n(check only - add --apply)");
      }
    }
  }
}
await mongoose.disconnect();
