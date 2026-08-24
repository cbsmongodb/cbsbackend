import mongoose from "mongoose";

const saleSchema = new mongoose.Schema(
  {
    drug: { type: mongoose.Schema.Types.ObjectId, ref: "Drug", required: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true },
    date: Date,
    totalNoOfBoxes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Rails: after_save decrements drug.stocks by total_no_of_boxes —
// do this in the controller/service after Sale.create, not here, since
// mongoose doesn't have a clean equivalent to ActiveRecord callbacks
// that's safe to run unconditionally on every save (including updates).

export default mongoose.model("Sale", saleSchema);
