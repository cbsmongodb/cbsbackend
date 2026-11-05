import mongoose from "mongoose";

// A month of the travel-expenses workbook that is already filled
// (imported from Excel, or computed once the month was over).
// Closed months are never recalculated automatically.
const expenseMonthSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    month: { type: Number, required: true }, // 1-12
    source: { type: String, enum: ["excel", "crm"], default: "crm" },
  },
  { timestamps: true }
);

expenseMonthSchema.index({ year: 1, month: 1 }, { unique: true });

export default mongoose.model("ExpenseMonth", expenseMonthSchema);
