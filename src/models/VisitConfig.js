import mongoose from "mongoose";

const visitConfigSchema = new mongoose.Schema(
  {
    visitConfigNumber: { type: String, unique: true, sparse: true },
    numberOfVisit: Number,
    minimumVisit: Number,
    maximumVisit: Number,
    profile: { type: mongoose.Schema.Types.ObjectId, ref: "Profile", required: true },
    doctorCategory: { type: mongoose.Schema.Types.ObjectId, ref: "DoctorCategory", required: true },
    determiningVisit: { type: mongoose.Schema.Types.ObjectId, ref: "DeterminingVisit", required: true },
  },
  { timestamps: true }
);

visitConfigSchema.pre("save", async function (next) {
  if (this.visitConfigNumber) return next();
  const last = await this.constructor.findOne().sort({ createdAt: -1 });
  const lastNum = last?.visitConfigNumber ? parseInt(last.visitConfigNumber.replace("VCD", ""), 10) : 0;
  this.visitConfigNumber = `VCD${lastNum + 1}`;
  next();
});

export default mongoose.model("VisitConfig", visitConfigSchema);
