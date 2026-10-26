import mongoose from "mongoose";
import { invalidateCachesOnWrite } from "../utils/cacheBus.js";

const sectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    head: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    region: { type: mongoose.Schema.Types.ObjectId, ref: "Region", required: true },
    note: String,
    isActive: { type: Boolean, default: false },
    // groups belonging to this section — a Division Manager (Section.head)
    // sees the union of all these groups' members/drugs/heads
    groups: [{ type: mongoose.Schema.Types.ObjectId, ref: "Group" }],
  },
  { timestamps: true }
);

// speeds up the most common filters (reports, dashboards, scope lookups)
sectionSchema.index({ head: 1 });
sectionSchema.index({ groups: 1 });

invalidateCachesOnWrite(sectionSchema);

export default mongoose.model("Section", sectionSchema);
