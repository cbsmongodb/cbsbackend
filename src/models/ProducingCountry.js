import mongoose from "mongoose";

const producingCountrySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("ProducingCountry", producingCountrySchema);
