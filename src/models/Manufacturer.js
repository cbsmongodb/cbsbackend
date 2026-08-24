import mongoose from "mongoose";

const manufacturerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    producingCountry: { type: mongoose.Schema.Types.ObjectId, ref: "ProducingCountry", required: true },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Manufacturer", manufacturerSchema);
