import mongoose from "mongoose";

const profileSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model("Profile", profileSchema);
