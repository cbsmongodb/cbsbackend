import mongoose from "mongoose";

// Singleton-style config — Rails always used NotificationConfig.first
const notificationConfigSchema = new mongoose.Schema(
  { daysBeforeMsgSent: { type: Number, default: 0 } },
  { timestamps: true }
);

export default mongoose.model("NotificationConfig", notificationConfigSchema);
