import mongoose from "mongoose";

// Singleton-style config — Rails always used BatchConfig.first
const batchConfigSchema = new mongoose.Schema(
  {
    showDocPic: { type: Boolean, default: false },
    showDrugPic: { type: Boolean, default: false },
    showEmployeePic: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("BatchConfig", batchConfigSchema);
