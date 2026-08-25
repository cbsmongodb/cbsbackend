import mongoose from "mongoose";

const leaveEntrySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    type: {
      type: String,
      enum: ["paid", "unpaid", "sick"],
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    daysCount: { type: Number, required: true },
    note: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  },
  { timestamps: true }
);

leaveEntrySchema.index({ employee: 1, startDate: 1 });

export default mongoose.model("LeaveEntry", leaveEntrySchema);
