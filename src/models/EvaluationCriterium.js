import mongoose from "mongoose";

const evaluationCriteriumSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    designation: { type: mongoose.Schema.Types.ObjectId, ref: "Designation", default: null },
    maxEvaluation: Number,
    description: String,
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("EvaluationCriterium", evaluationCriteriumSchema);
