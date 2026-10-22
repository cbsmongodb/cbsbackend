import mongoose from "mongoose";

const errorLogSchema = new mongoose.Schema(
  {
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    // context: who / where / what
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    employeeName: String,
    employeeRole: String,
    page: String,       // page in the app, e.g. /ka/dashboard/plannings
    action: String,     // e.g. "ვიზიტის დაგეგმვა"
    method: String,
    apiPath: String,
    query: String,
    bodyKeys: String,
    hint: String,       // how to fix it
  },
  { timestamps: true }
);

// auto-expire after 30 days so this collection never grows unbounded
errorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export default mongoose.model("ErrorLog", errorLogSchema);
