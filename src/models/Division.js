import mongoose from "mongoose";

// Not present in the Rails app — kept because the dashboard filters
// referenced a "Division" dropdown. Harmless if unused.
const divisionSchema = new mongoose.Schema(
  { name: { type: String, required: true, unique: true } },
  { timestamps: true }
);

export default mongoose.model("Division", divisionSchema);
