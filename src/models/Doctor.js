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
    pharmacies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy" }],

    isActive: { type: Boolean, default: false },
    isBudgeted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

doctorSchema.virtual("name").get(function () {
  return [this.firstName, this.lastName].filter(Boolean).join(" ");
});
// the hospitals as a plain list (populated docs or ids) — what the Doctor
// form's multi-select reads; saving it is handled in doctors.controller.js
doctorSchema.virtual("hospitalIds").get(function () {
  return (this.hospitals || []).map((h) => h.hospital).filter(Boolean);
});
doctorSchema.set("toJSON", { virtuals: true });

// .lean() skips virtuals — add the same "name" / "hospitalIds" / "id" the JSON
// output had, so lean queries (and lean populates) return the same shape
function addLeanVirtuals(res) {
  if (!res || !this.mongooseOptions().lean) return;
  for (const d of Array.isArray(res) ? res : [res]) {
    if (!d || typeof d !== "object") continue;
    if (d.name === undefined && (d.firstName !== undefined || d.lastName !== undefined)) {
      d.name = [d.firstName, d.lastName].filter(Boolean).join(" ");
    }
    if (d.hospitalIds === undefined && Array.isArray(d.hospitals)) {
      d.hospitalIds = d.hospitals.map((h) => h && h.hospital).filter(Boolean);
    }
    if (d._id && d.id === undefined) d.id = String(d._id);
  }
}
doctorSchema.post("find", addLeanVirtuals);
doctorSchema.post("findOne", addLeanVirtuals);

// speeds up the most common filters (reports, dashboards, scope lookups)
doctorSchema.index({ "hospitals.hospital": 1 });

export default mongoose.model("Doctor", doctorSchema);
