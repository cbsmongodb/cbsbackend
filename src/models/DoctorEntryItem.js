import mongoose from "mongoose";

// The current, active "Doctor Sales Entry" system — one row per
// employee + doctor + drug + period (month). Replaces the legacy
// Prescription/DoctorTarget flow for new data.
const doctorEntryItemSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    hospital: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", default: null },

    // always normalized to the 1st of the month
    period: { type: Date, required: true },

    quota: { type: Number, default: 0 },
    prescription: { type: Number, default: 0 },
    sale: { type: Number, default: 0 },
    budget: { type: Number, default: 0 }, // per-box bonus rate for this item
    difference: { type: Number, default: 0 },

    issuedBudget: { type: Number, default: 0 },
    plannedBudget: { type: Number, default: 0 },
    totalBudget: { type: Number, default: 0 }, // prescription * budget * coefficient
    budgetCalculation: { type: Number, default: 0 },

    analysisOfCurrentMonth: { type: Number, default: 0 },
    analysisOfPreviousMonth: { type: Number, default: 0 },
    prescriptionFulfillment: { type: Number, default: 0 },

    bank: { type: String, enum: ["BOG", "TBC", "Liberty", "Cash", "Pharmacy"] },
    visits: String,
  },
  { timestamps: true }
);

doctorEntryItemSchema.index(
  { employee: 1, doctor: 1, drug: 1, period: 1 },
  { unique: true }
);
doctorEntryItemSchema.index({ employee: 1, period: 1 });

export default mongoose.model("DoctorEntryItem", doctorEntryItemSchema);
