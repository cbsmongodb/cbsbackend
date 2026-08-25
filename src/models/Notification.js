import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
        notifiableType: { type: String, enum: ["Task", "BudgetRequest", "BudgetRequird", "StockAlert"], required: true },
    notifiableId: { type: mongoose.Schema.Types.ObjectId, required: true },
    message: String,
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ employee: 1, read: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
