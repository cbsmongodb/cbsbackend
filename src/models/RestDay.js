import mongoose from "mongoose";

const restDaySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, unique: true },
    label: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  },
  { timestamps: true }
);

export default mongoose.model("RestDay", restDaySchema);
