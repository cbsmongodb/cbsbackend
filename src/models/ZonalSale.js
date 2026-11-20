import mongoose from "mongoose";

// Zonal sales — one row per line of the uploaded Excel.
// The exact columns come from the Excel (kept in `data`), so the page shows whatever the file has.
// `division` decides who sees the row: division managers only their own, director / finance / office everything.
const zonalSaleSchema = new mongoose.Schema(
  {
    month: { type: String, required: true }, // "2026-11"
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Section", default: null },
    zone: String, // თბილისი, კახეთი, სამეგრელო...
    chain: String, // pharmacy network: PSP, Aversi, GPC...
    product: String,
    qty: { type: Number, default: 0 },
    amount: { type: Number, default: 0 }, // GEL
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // { "<column>": value }
    importBatch: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true, minimize: false }
);

zonalSaleSchema.index({ month: 1, division: 1 });
zonalSaleSchema.index({ month: 1, zone: 1 });

export default mongoose.model("ZonalSale", zonalSaleSchema);
