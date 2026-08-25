import mongoose from "mongoose";

// Admin-set override — if present for an employee+drug+period, this value
// is used instead of the auto-calculated (sale/prescription) coefficient
// in DoctorEntryItem calculations.
const coefficientOverrideSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    period: { type: Date, required: true },
    coefficient: { type: Number, required: true },
    note: String,
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  },
  { timestamps: true }
);

coefficientOverrideSchema.index({ employee: 1, drug: 1, period: 1 }, { unique: true });

export default mongoose.model("CoefficientOverride", coefficientOverrideSchema);
