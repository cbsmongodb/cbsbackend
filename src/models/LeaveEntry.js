import mongoose from "mongoose";

const leaveEntrySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    type: {
      type: String,
      enum: ["paid", "unpaid", "sick", "mixed"],
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    daysCount: { type: Number, required: true },
    note: String,
    // self-service requests: every chosen day with its own type (paid / unpaid / sick)
    days: [
      {
        _id: false,
        date: { type: Date, required: true },
        type: { type: String, enum: ["paid", "unpaid", "sick"], required: true },
      },
    ],
    // old entries (added by admin) have no status = approved
    status: { type: String, enum: ["pending", "approved", "rejected", "canceled"], default: "approved" },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  },
  { timestamps: true }
);

leaveEntrySchema.index({ employee: 1, startDate: 1 });

export default mongoose.model("LeaveEntry", leaveEntrySchema);
