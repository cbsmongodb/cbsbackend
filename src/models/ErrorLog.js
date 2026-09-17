import mongoose from "mongoose";

const errorLogSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// auto-expire after 30 days so this collection never grows unbounded
errorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default mongoose.model("ErrorLog", errorLogSchema);
