import mongoose from "mongoose";

const planConfigurationDoctorSchema = new mongoose.Schema(
  {
    planConfiguration: { type: mongoose.Schema.Types.ObjectId, ref: "PlanConfiguration", required: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    note: String,
    status: { type: String, default: "planned" },
  },
  { timestamps: true }
);

export default mongoose.model("PlanConfigurationDoctor", planConfigurationDoctorSchema);
