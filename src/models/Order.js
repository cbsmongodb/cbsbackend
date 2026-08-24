import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    pack: { type: String, required: true },
    priceFobUsd: { type: String, required: true },
    quantity: { type: Number, required: true },
    amountUsd: String,
  },
  { timestamps: true }
);

export default mongoose.model("Order", orderSchema);
