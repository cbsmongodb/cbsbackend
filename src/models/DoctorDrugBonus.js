import mongoose from "mongoose";

// A doctor-specific bonus: for THIS doctor, THIS drug, THIS month the bonus per
// box is different from the drug's normal (monthly) bonus — e.g. a more
// important doctor gets more. Wins over DrugBonus / Drug.bonus / the default.
const doctorDrugBonusSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    // the 1st of the month, UTC midnight (same as DrugBonus)
    period: { type: Date, required: true },
    value: { type: Number, required: true, min: 0 },
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true }
);

// one doctor + one drug + one month = one record
doctorDrugBonusSchema.index({ doctor: 1, drug: 1, period: 1 }, { unique: true });
doctorDrugBonusSchema.index({ period: 1, drug: 1 });

export default mongoose.model("DoctorDrugBonus", doctorDrugBonusSchema);
