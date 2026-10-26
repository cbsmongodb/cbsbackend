import mongoose from "mongoose";

const planConfigurationSchema = new mongoose.Schema(
  {
    planNumber: { type: String, unique: true, sparse: true }, // auto "PL1", "PL2"...
    planType: { type: String, enum: ["hospital", "pharmacy", "general", "double visit"], required: true },
    period: { type: Date, required: true },

    status: {
      type: String,
      enum: ["planned", "canceled", "completed", "i_left", "i_went"],
      default: "planned",
      required: true,
    },

    comment: String,
    contentOfAssignment: String,

    iWentAt: Date,
    iLeftAt: Date,

    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    hospital: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", default: null },
    pharmacy: { type: mongoose.Schema.Types.ObjectId, ref: "Pharmacy", default: null },
    // who created the plan
    author: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    // who is assigned to carry it out (usually the same as author, can differ)
    performer: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  },
  { timestamps: true }
);

planConfigurationSchema.index({ performer: 1, period: 1 });
planConfigurationSchema.index({ period: -1 });

// Rails: generate_plan_number, sequential "PL1", "PL2", ...
planConfigurationSchema.pre("save", async function (next) {
  if (this.planNumber) return next();
  // next number = the HIGHEST existing "PL<n>" + 1 (imported visits have no number,
  // so "the last created one" is not a safe base)
  const [top] = await this.constructor.aggregate([
    { $match: { planNumber: /^PL\d+$/ } },
    { $project: { n: { $toInt: { $substrCP: ["$planNumber", 2, 12] } } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]);
  this.planNumber = `PL${(top?.n || 0) + 1}`;
  next();
});

export default mongoose.model("PlanConfiguration", planConfigurationSchema);
