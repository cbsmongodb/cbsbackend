import mongoose from "mongoose";

const employeeTargetSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    date: Date,
  },
  { timestamps: true }
);

export default mongoose.model("EmployeeTarget", employeeTargetSchema);
