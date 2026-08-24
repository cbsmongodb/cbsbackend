import mongoose from "mongoose";

const budgetSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    date: Date,
    isActive: { type: Boolean, default: true },

    paidAmount: { type: Number, default: 0 },
    prescriptionAmt: { type: Number, default: 0 },
    payableAmt: { type: Number, default: 0 },
    targetAmount: { type: Number, default: 0 },
    salesAmount: { type: Number, default: 0 },
    advanceAmount: { type: Number, default: 0 },

    // denormalized from employee.group at save time (Rails does this via
    // an after_save callback) — fill these in the controller on create
    region: { type: mongoose.Schema.Types.ObjectId, ref: "Region", default: null },
    section: { type: mongoose.Schema.Types.ObjectId, ref: "Section", default: null },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null },
  },
  { timestamps: true }
);

budgetSchema.index({ employee: 1, date: 1 });
budgetSchema.index({ doctor: 1 });

export default mongoose.model("Budget", budgetSchema);
