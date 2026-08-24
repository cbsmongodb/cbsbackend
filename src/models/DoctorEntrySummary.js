import mongoose from "mongoose";

// Month-level rollup per employee + drug — holds the quota total that
// DoctorEntryItem rows are measured against.
const doctorEntrySummarySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    period: { type: Date, required: true },
    quota: { type: Number, default: 0 },
    prescription: { type: Number, default: 0 },
  },
  { timestamps: true }
);

doctorEntrySummarySchema.index({ employee: 1, drug: 1, period: 1 }, { unique: true });

export default mongoose.model("DoctorEntrySummary", doctorEntrySummarySchema);
