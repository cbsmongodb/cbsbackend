import mongoose from "mongoose";

// Polymorphic — attaches a per-drug box count to any of DoctorSale,
// DoctorTarget, EmployeeSale, or EmployeeTarget.
const medicineTargetSchema = new mongoose.Schema(
  {
    medicineTargatableType: {
      type: String,
      enum: ["DoctorSale", "DoctorTarget", "EmployeeSale", "EmployeeTarget"],
      required: true,
    },
    medicineTargatableId: { type: mongoose.Schema.Types.ObjectId, required: true },
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    totalNoOfBoxes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

medicineTargetSchema.index({ medicineTargatableType: 1, medicineTargatableId: 1 });

export default mongoose.model("MedicineTarget", medicineTargetSchema);
