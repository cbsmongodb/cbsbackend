import mongoose from "mongoose";

// One official timesheet (ტაბელი): "დივიზიონი 1 თბილისი", "ოფისი", "საწყობი"...
const timesheetSheetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },   // "div1-tbilisi"
    title: { type: String, required: true },              // printed in the form header
    section: { type: mongoose.Schema.Types.ObjectId, ref: "Section", default: null }, // division -> its manager sees it
    head: { type: String, default: "" },                  // ორგანიზაციის/სტრუქტურული ქვედანაყოფის ხელმძღვანელი
    responsible: { type: String, default: "" },           // ტაბელის შედგენაზე პასუხისმგებელი პირი
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model("TimesheetSheet", timesheetSheetSchema);
