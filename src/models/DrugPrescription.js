import mongoose from "mongoose";

const drugPrescriptionSchema = new mongoose.Schema(
  {
    prescription: { type: mongoose.Schema.Types.ObjectId, ref: "Prescription", required: true },
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    totalNoOfBoxes: { type: Number, default: 0 },
    saleBoxes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// speeds up the most common filters (reports, dashboards, scope lookups)
drugPrescriptionSchema.index({ prescription: 1 });
drugPrescriptionSchema.index({ drug: 1 });

export default mongoose.model("DrugPrescription", drugPrescriptionSchema);
