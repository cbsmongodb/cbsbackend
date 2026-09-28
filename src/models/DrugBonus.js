import mongoose from "mongoose";

// თითო წამალს — თითო თვეზე თავისი ბონუსი.
// zone (თბილისი/რეგიონი) მოგვიანებით დაემატება ამავე სქემას.
const drugBonusSchema = new mongoose.Schema(
  {
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    // თვის პირველი დღე ინახება ნორმალიზებულად: 2026-08-01
    period: { type: Date, required: true },
    value: { type: Number, required: true, default: 0 },
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true }
);

// ერთი წამალი + ერთი თვე = ერთი ჩანაწერი (დუბლიკატის თავიდან აცილება)
drugBonusSchema.index({ drug: 1, period: 1 }, { unique: true });

export default mongoose.model("DrugBonus", drugBonusSchema);
