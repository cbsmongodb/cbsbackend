import mongoose from "mongoose";

const marketingProductSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    productType: String,
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("MarketingProduct", marketingProductSchema);
