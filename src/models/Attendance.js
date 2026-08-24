import mongoose from "mongoose";

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    attendanceType: { type: String, enum: ["checkin", "checkout"], required: true },
    attendanceStatus: {
      type: String,
      enum: ["ontime", "late_checkin", "early_checkout"],
      default: "ontime",
    },
    attendanceTime: { type: Date, default: Date.now },
    targetPoint: Number,
    // set when this attendance was triggered from a plan's i_went/i_left,
    // rather than the standalone daily checkin/checkout button
    viaPlan: { type: mongoose.Schema.Types.ObjectId, ref: "PlanConfiguration", default: null },
  },
  { timestamps: true }
);

attendanceSchema.index({ employee: 1, attendanceTime: -1 });

export default mongoose.model("Attendance", attendanceSchema);
