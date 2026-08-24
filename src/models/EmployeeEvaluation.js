import mongoose from "mongoose";

const employeeEvaluationSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    appraiser: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    date: String,
  },
  { timestamps: true }
);

export default mongoose.model("EmployeeEvaluation", employeeEvaluationSchema);
