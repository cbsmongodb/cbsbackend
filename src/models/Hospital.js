import mongoose from "mongoose";

const hospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    region: { type: mongoose.Schema.Types.ObjectId, ref: "Region", required: true },
    address: String,
    email: String,
    phoneNumber: String,
    note: String,
    lat: Number,
    lng: Number,
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Hospital", hospitalSchema);
