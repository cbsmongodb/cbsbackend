import mongoose from "mongoose";

// A day someone changed by hand on the timesheet (e.g. "გ", "4", "ს/ფ").
// Days without a row here are filled automatically.
const timesheetCellSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: "TimesheetMember", required: true },
    date: { type: String, required: true },   // "yyyy-mm-dd"
    value: { type: String, required: true },  // "8", "4", "დ", "ა/შ", "უხ/შ", "ს/ფ", "გ", "დ/შ"
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  },
  { timestamps: true }
);

timesheetCellSchema.index({ member: 1, date: 1 }, { unique: true });

export default mongoose.model("TimesheetCell", timesheetCellSchema);
