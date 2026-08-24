import mongoose from "mongoose";

const sectionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    head: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    region: { type: mongoose.Schema.Types.ObjectId, ref: "Region", required: true },
    note: String,
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Section", sectionSchema);
