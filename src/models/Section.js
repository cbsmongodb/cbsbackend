import mongoose from "mongoose";

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

export default mongoose.model("Section", sectionSchema);
