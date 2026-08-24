import mongoose from "mongoose";

// Rails' DoctorHospital join table (with floor/room/additional_info) is
// embedded directly on the doctor — no separate collection needed.
const doctorHospitalSchema = new mongoose.Schema(
  {
    hospital: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", required: true },
    floor: Number,
    room: Number,
    additionalInfo: String,
  },
  { _id: true }
);

const doctorSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    uniqueNumber: { type: String, required: true, unique: true },
    dateOfBirth: Date,
    email: String,
    phoneNumber: String,
    loyalty: String,
    note: String,

    profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile", required: true },
    doctorCategory: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorCategory", required: true },

    hospitals: [doctorHospitalSchema],

    isActive: { type: Boolean, default: false },
    isBudgeted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

doctorSchema.virtual("name").get(function () {
  return [this.firstName, this.lastName].filter(Boolean).join(" ");
});
doctorSchema.set("toJSON", { virtuals: true });

export default mongoose.model("Doctor", doctorSchema);
