import mongoose from "mongoose";

const employeeRatingSchema = new mongoose.Schema(
  {
    employeeEvaluation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmployeeEvaluation",
      required: true,
    },
    evaluationCriterium: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EvaluationCriterium",
      required: true,
    },
    maxEvaluationNo: Number,
  },
  { timestamps: true }
);

export default mongoose.model("EmployeeRating", employeeRatingSchema);
