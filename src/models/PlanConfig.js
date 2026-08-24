import mongoose from "mongoose";

// Singleton-style config — Rails always used PlanConfig.first
const planConfigSchema = new mongoose.Schema(
  {
    distanceError: { type: Number, default: 0 },
    doctorRequiredForAssignmentCompletion: { type: Boolean, default: false },
    editingDeadline: { type: Number, default: 1 },
    workStartTime: { type: String, default: "10:00" },
    workEndTime: { type: String, default: "17:00" },
  },
  { timestamps: true }
);

export default mongoose.model("PlanConfig", planConfigSchema);
