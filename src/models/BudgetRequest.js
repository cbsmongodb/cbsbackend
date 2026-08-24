import mongoose from "mongoose";

const budgetRequestSchema = new mongoose.Schema(
  {
    budgetRequird: { type: mongoose.Schema.Types.ObjectId, ref: "BudgetRequird", required: true },
    divisionManager: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    financeManager: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    financeStatus: {
      type: String,
      enum: ["pending", "finance_approved", "finance_rejected"],
      default: "pending",
    },
    cancelReason: String,
  },
  { timestamps: true }
);

export default mongoose.model("BudgetRequest", budgetRequestSchema);
