import mongoose from "mongoose";

// Rails calls this field "position", not "name" — matched exactly here.
const designationSchema = new mongoose.Schema(
  {
    position: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Designation", designationSchema);
