import mongoose from "mongoose";

const regionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: false },
    // used by the Reimbursement Report — fixed amount per region
    reimbursementAmt: { type: Number, default: 0 },
    // Rails supports region -> sub_regions (self-referential parent_id)
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "Region", default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Region", regionSchema);
