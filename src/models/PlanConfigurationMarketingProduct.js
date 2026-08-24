import mongoose from "mongoose";

const planConfigurationMarketingProductSchema = new mongoose.Schema(
  {
    planConfigurationDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlanConfigurationDoctor",
      required: true,
    },
    planConfigurationDoctorDrug: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlanConfigurationDoctorDrug",
      default: null,
    },
    marketingProduct: { type: mongoose.Schema.Types.ObjectId, ref: "MarketingProduct", required: true },
    quantity: Number,
    notes: String,
  },
  { timestamps: true }
);

export default mongoose.model("PlanConfigurationMarketingProduct", planConfigurationMarketingProductSchema);
