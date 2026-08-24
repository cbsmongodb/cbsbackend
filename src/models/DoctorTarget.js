import mongoose from "mongoose";

const doctorTargetSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    date: Date,
  },
  { timestamps: true }
);

export default mongoose.model("DoctorTarget", doctorTargetSchema);
