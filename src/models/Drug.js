import mongoose from "mongoose";

const batchSchema = new mongoose.Schema(
  {
    name: String,
    numberOfBoxes: { type: Number, default: 0 },
  },
  { _id: true }
);

const drugSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    productType: { type: mongoose.Schema.Types.ObjectId, ref: "ProductType", required: true },

    // many-to-many in Rails — plain arrays here
    profiles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Profile" }],
    manufacturers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Manufacturer" }],

    price: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
    stocks: { type: Number, default: 0 },
    monthlyTarget: { type: Number, default: 0 },
    incentivePercentage: { type: Number, default: 10.0 },

    generalDescription: String,
    inputComponent: String,
    keyMessages: String,
    imageUrl: String,
    videoUrl: String,

    expiringDate: Date,
    expired: { type: Boolean, default: false },

    batches: [batchSchema],

    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const LOW_STOCK_THRESHOLD = 100;

// Rails: Drug.check_low_stock
drugSchema.statics.checkLowStock = async function () {
  const lowStockDrugs = await this.find({ stocks: { $lt: LOW_STOCK_THRESHOLD } });
  return lowStockDrugs.map((d) => ({ id: d._id, name: d.name, stock: d.stocks }));
};

// Rails: Drug.check_expired_drugs
drugSchema.statics.checkExpiredDrugs = async function () {
  const expiredDrugs = await this.find({ expired: true });
  return expiredDrugs.map((d) => ({ id: d._id, name: d.name, status: "Expired" }));
};

// Rails: Drug.update_all_expired_status — run this on a schedule (cron/node-cron)
drugSchema.statics.updateAllExpiredStatus = async function () {
  const sevenMonthsFromNow = new Date();
  sevenMonthsFromNow.setMonth(sevenMonthsFromNow.getMonth() + 7);
  await this.updateMany(
    { expiringDate: { $lte: sevenMonthsFromNow }, expired: false },
    { $set: { expired: true } }
  );
};

export default mongoose.model("Drug", drugSchema);
