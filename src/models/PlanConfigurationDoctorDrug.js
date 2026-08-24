import mongoose from "mongoose";

const planConfigurationDoctorDrugSchema = new mongoose.Schema(
  {
    planConfigurationDoctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PlanConfigurationDoctor",
      required: true,
    },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },

    agreement: Number,
    oldAgreement: Number,
    potential: Number,
    oldPotential: Number,
    visitReceipe: Number,
  },
  { timestamps: true }
);

export default mongoose.model("PlanConfigurationDoctorDrug", planConfigurationDoctorDrugSchema);
