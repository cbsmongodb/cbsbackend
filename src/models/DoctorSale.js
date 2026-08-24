import mongoose from "mongoose";

const doctorSaleSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    date: Date,
  },
  { timestamps: true }
);

export default mongoose.model("DoctorSale", doctorSaleSchema);
