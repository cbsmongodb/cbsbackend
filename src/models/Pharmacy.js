import mongoose from "mongoose";

const pharmacySchema = new mongoose.Schema(
  {
    // Rails field is "pharmacy_name", not "name" — kept exact
    pharmacyName: { type: String, required: true },
    region: { type: mongoose.Schema.Types.ObjectId, ref: "Region", required: true },
    address: String,
    email: String,
    phoneNumber: String,
    pharmacyCategory: String,
    note: String,
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Pharmacy", pharmacySchema);
