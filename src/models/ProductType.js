import mongoose from "mongoose";

const productTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("ProductType", productTypeSchema);
