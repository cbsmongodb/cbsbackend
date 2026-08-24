import mongoose from "mongoose";

const planOpportunitySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    initialDate: String,
    planOpportunityNumber: { type: String, unique: true, sparse: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  },
  { timestamps: true }
);

planOpportunitySchema.pre("save", async function (next) {
  if (this.planOpportunityNumber) return next();
  const last = await this.constructor.findOne().sort({ createdAt: -1 });
  const lastNum = last?.planOpportunityNumber
    ? parseInt(last.planOpportunityNumber.replace("PLOPRTY", ""), 10)
    : 0;
  this.planOpportunityNumber = `PLOPRTY${lastNum + 1}`;
  next();
});

export default mongoose.model("PlanOpportunity", planOpportunitySchema);
