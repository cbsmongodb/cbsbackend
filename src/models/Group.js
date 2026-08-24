import mongoose from "mongoose";

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
  },
  { timestamps: true }
);

export default mongoose.model("Group", groupSchema);
