import mongoose from "mongoose";

// Polymorphic location record — mirrors Rails' Address model exactly.
// Used for three different things, distinguished by addressableType +
// addressType:
//   Employee + current_location              → last known GPS ping
//   Attendance + attendance                   → where a check-in/out happened
//   PlanConfiguration + performer_i_went_location / performer_i_left_location
const addressSchema = new mongoose.Schema(
  {
    addressableType: {
      type: String,
      enum: ["Employee", "Attendance", "PlanConfiguration"],
      required: true,
    },
    addressableId: { type: mongoose.Schema.Types.ObjectId, required: true },
    addressType: {
      type: String,
      enum: [
        "current_location",
        "attendance",
        "performer_i_went_location",
        "performer_i_left_location",
      ],
      required: true,
    },

    lat: Number,
    lng: Number,
    line1: String,
    line2: String,
    city: String,
    district: String,
    state: String,
    pincode: String,
    cleanAddress: String,
  },
  { timestamps: true }
);

addressSchema.index({ addressableType: 1, addressableId: 1, addressType: 1 });

export default mongoose.model("Address", addressSchema);
