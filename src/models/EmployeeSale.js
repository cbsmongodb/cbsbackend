import mongoose from "mongoose";

const employeeSaleSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    date: Date,
  },
  { timestamps: true }
);

// speeds up the most common filters (reports, dashboards, scope lookups)
employeeSaleSchema.index({ employee: 1, date: 1 });
employeeSaleSchema.index({ date: 1 });

export default mongoose.model("EmployeeSale", employeeSaleSchema);
