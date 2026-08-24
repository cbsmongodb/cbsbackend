import mongoose from "mongoose";

const doctorCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: String,
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("DoctorCategory", doctorCategorySchema);
