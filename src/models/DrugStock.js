import mongoose from "mongoose";

// One row per drug per month, uploaded from the accountant's stock Excel.
// The latest month is also copied into Drug.stocks, which the Director
// dashboard (Stock Availability, Opening/Closing stocks) already reads.
const drugStockSchema = new mongoose.Schema(
  {
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ }, // "2026-10"
    stocks: { type: Number, required: true, default: 0 },
    sourceName: String, // the name exactly as written in the Excel file
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true }
);

drugStockSchema.index({ drug: 1, period: 1 }, { unique: true });
drugStockSchema.index({ period: -1 });

export default mongoose.model("DrugStock", drugStockSchema);
