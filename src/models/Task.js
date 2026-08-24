import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    taskName: { type: String, required: true },
    taskDescription: String,
    taskType: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "cancelled"],
      default: "pending",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Task", taskSchema);
