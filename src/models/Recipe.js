import mongoose from "mongoose";

const recipeSchema = new mongoose.Schema(
  {
    number: { type: String, unique: true, sparse: true },
    date: String,
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "Doctor", required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  },
  { timestamps: true }
);

recipeSchema.pre("save", async function (next) {
  if (this.number) return next();
  const last = await this.constructor.findOne().sort({ createdAt: -1 });
  const lastNum = last?.number ? parseInt(last.number.replace("RC", ""), 10) : 0;
  this.number = `RC${lastNum + 1}`;
  next();
});

export default mongoose.model("Recipe", recipeSchema);
