import mongoose from "mongoose";

const employeeAccountSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    date: Date,
    targetAmount: { type: Number, default: 0 },
    sale: { type: Number, default: 0 },
    percentAchieved: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("EmployeeAccount", employeeAccountSchema);
