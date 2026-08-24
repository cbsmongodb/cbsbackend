import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    // e.g. ["employees.read", "drugs.write", "reports.read"] — filled in once
    // real permission rules are ported over from the Rails app.
    permissions: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.model("Role", roleSchema);
