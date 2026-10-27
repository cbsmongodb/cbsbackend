import mongoose from "mongoose";

// A person on a timesheet. Linked to a CRM employee when there is one, so
// leave / sick days fill in automatically; the printed data (Georgian name,
// personal ID, position, hours) is kept here and can be edited.
const timesheetMemberSchema = new mongoose.Schema(
  {
    sheet: { type: String, required: true, index: true },  // TimesheetSheet.key
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    nameKa: { type: String, required: true },
    personalId: { type: String, default: "" },
    position: { type: String, default: "" },
    hours: { type: Number, default: 8 },                    // hours on a normal working day
    workDays: { type: [Number], default: [1, 2, 3, 4, 5] }, // 0 = Sunday ... 6 = Saturday
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

timesheetMemberSchema.index({ sheet: 1, order: 1 });

export default mongoose.model("TimesheetMember", timesheetMemberSchema);
