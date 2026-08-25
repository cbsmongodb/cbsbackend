import mongoose from "mongoose";

const leaveBalanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    year: { type: Number, required: true },

    paidDaysTotal: { type: Number, default: 24 },
    unpaidDaysTotal: { type: Number, default: 0 },
    sickDaysTotal: { type: Number, default: 0 },
  },
  { timestamps: true }
);

leaveBalanceSchema.index({ employee: 1, year: 1 }, { unique: true });

export default mongoose.model("LeaveBalance", leaveBalanceSchema);
