import mongoose from "mongoose";

const doctorTargetSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    date: Date,
  },
  { timestamps: true }
);

// speeds up the most common filters (reports, dashboards, scope lookups)
doctorTargetSchema.index({ date: 1 });
doctorTargetSchema.index({ doctor: 1, employee: 1, date: 1 });

export default mongoose.model("DoctorTarget", doctorTargetSchema);
