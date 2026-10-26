import mongoose from "mongoose";
import { invalidateCachesOnWrite } from "../utils/cacheBus.js";

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    // "head" of the group — a manager Employee
    head: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    region: { type: mongoose.Schema.Types.ObjectId, ref: "Region", required: true },
    section: { type: mongoose.Schema.Types.ObjectId, ref: "Section" },
    note: String,
    isActive: { type: Boolean, default: false },
    // Rails used a GroupDrug join table — a plain array is simpler in Mongo
    drugs: [{ type: mongoose.Schema.Types.ObjectId, ref: "Drug" }],
    // employees who belong to this group
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],
  },
  { timestamps: true }
);

// speeds up the most common filters (reports, dashboards, scope lookups)
groupSchema.index({ section: 1 });
groupSchema.index({ head: 1 });

invalidateCachesOnWrite(groupSchema);

export default mongoose.model("Group", groupSchema);
