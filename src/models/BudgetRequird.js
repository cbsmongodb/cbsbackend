import mongoose from "mongoose";

const budgetRequiredItemSchema = new mongoose.Schema(
  {
    doctor: String,
    hospital: String,
    drug: [String],
    totalCost: String,
  },
  { _id: true }
);

// Rails name kept intentionally ("Requird", not "Required" — matches
// the original typo so it stays recognizable against the old app).
const budgetRequirdSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    status: {
      type: String,
      enum: ["pending", "manager_approved", "finance_approved", "manager_rejected", "finance_rejected"],
      default: "pending",
    },
    items: [budgetRequiredItemSchema],
  },
  { timestamps: true }
);

export default mongoose.model("BudgetRequird", budgetRequirdSchema);
