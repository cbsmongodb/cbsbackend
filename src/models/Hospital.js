import mongoose from "mongoose";
import { geocodeAddress } from "../utils/geocode.js";

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

hospitalSchema.pre("save", async function (next) {
  if (this.isModified("address") && this.address && (this.lat == null || this.lng == null)) {
    const coords = await geocodeAddress(this.address);
    if (coords) {
      this.lat = coords.lat;
      this.lng = coords.lng;
    }
  }
  next();
});

export default mongoose.model("Hospital", hospitalSchema);
