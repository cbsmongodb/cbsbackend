import mongoose from "mongoose";

const determiningVisitSchema = new mongoose.Schema(
  {
    name: String,
    initialDate: String,
    deadlineDate: String,
    visitNumber: { type: String, unique: true, sparse: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  },
  { timestamps: true }
);

determiningVisitSchema.pre("save", async function (next) {
  if (this.visitNumber) return next();
  const last = await this.constructor.findOne().sort({ createdAt: -1 });
  const lastNum = last?.visitNumber ? parseInt(last.visitNumber.replace("VC", ""), 10) : 0;
  this.visitNumber = `VC${lastNum + 1}`;
  next();
});

export default mongoose.model("DeterminingVisit", determiningVisitSchema);
