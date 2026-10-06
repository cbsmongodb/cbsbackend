// Stocks page: Accountant's assistant uploads, Director views.
// Only the stock_upload key is touched. Safe to re-run.
//   node src/scripts/setStockAccess.js
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Role from "../models/Role.js";

const OFF = { read: 0, add: 0, update: 0, delete: 0, import: 0, export: 0, dashboard: 0, live_feeds: 0, last_locations: 0, analytics: 0 };

const ACCESS = [
  { match: /^\s*accountant.?s\s+assistant\s*$/i, label: "Accountant's assistant", value: { ...OFF, read: 1, add: 1, update: 1, delete: 1 } },
  { match: /^\s*director\s*$/i, label: "Director", value: { ...OFF, read: 1 } },
];

async function run() {
  await connectDB();
  for (const a of ACCESS) {
    const role = await Role.findOne({ name: a.match });
    if (!role) { console.log(`  ! role not found: ${a.label}`); continue; }
    role.privileges.set("stock_upload", a.value);
    role.markModified("privileges");
    await role.save();
    const on = ["read", "add", "update", "delete"].filter((k) => a.value[k] === 1);
    console.log(`  - ${role.name.padEnd(24)} stock_upload: ${on.join(", ")}`);
  }
  await mongoose.disconnect();
}
run().catch((e) => { console.error("Failed:", e); process.exit(1); });
