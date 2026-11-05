import mongoose from "mongoose";

// One line of the yearly travel-expenses workbook (Expenses_YYYY.xlsx):
// a person, their region (REG column) and 12 monthly amounts.
// Old months come from the imported Excel; every finished month after that
// is filled automatically from the Reimbursement report and stays as saved.
const expenseRowSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    order: { type: Number, default: 0 },
    name: { type: String, required: true },                 // as printed: "TAMUNA JINJOLAVA"
    region: { type: String, default: "" },                  // REG column (regional reps -> yellow row)
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    left: { type: Boolean, default: false },                // grey row, not copied to the next year
    amounts: { type: [Number], default: () => Array(12).fill(null) }, // index 0 = January; null = empty
  },
  { timestamps: true }
);

expenseRowSchema.index({ year: 1, order: 1 });

export default mongoose.model("ExpenseRow", expenseRowSchema);
