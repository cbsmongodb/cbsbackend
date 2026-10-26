import mongoose from "mongoose";

// Legacy sales record — superseded by DoctorEntryItem for new data entry,
// but still read/written for backwards compatibility and cleanup sync.
const prescriptionSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    date: Date,
    totalNoOfDrugs: Number,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// speeds up the most common filters (reports, dashboards, scope lookups)
prescriptionSchema.index({ date: -1 });
prescriptionSchema.index({ employee: 1, date: -1 });
prescriptionSchema.index({ doctor: 1, employee: 1, date: 1 });

export default mongoose.model("Prescription", prescriptionSchema);
