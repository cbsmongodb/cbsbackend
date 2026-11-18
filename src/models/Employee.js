import mongoose from "mongoose";
import { invalidateCachesOnWrite } from "../utils/cacheBus.js";
import { geocodeAddress } from "../utils/geocode.js";

const employeeSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, default: "" },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },

    personnelNumber: String,
    phoneNumber: String,
    note: String,
    avatarUrl: String,

    employeeType: { type: String, enum: ["field", "office"], default: "field" },

    workDays: { type: [Number], default: [1, 2, 3, 4, 5] },

    designation: { type: mongoose.Schema.Types.ObjectId, ref: "Designation", default: null },
    role: { type: mongoose.Schema.Types.ObjectId, ref: "Role", required: true },

    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null },

    // which bonus the rep gets: Tbilisi or region (Bonuses page). Missing = Tbilisi.
    area: { type: String, enum: ["tbilisi", "region"], default: "tbilisi" },

    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

employeeSchema.virtual("name").get(function () {
  return [this.firstName, this.lastName].filter(Boolean).join(" ");
});
employeeSchema.set("toJSON", { virtuals: true });

// .lean() skips virtuals — add the same "name" / "id" the JSON output had,
// so lean queries (and lean populates) return exactly the same shape
function addLeanVirtuals(res) {
  if (!res || !this.mongooseOptions().lean) return;
  for (const d of Array.isArray(res) ? res : [res]) {
    if (!d || typeof d !== "object") continue;
    if (d.name === undefined && (d.firstName !== undefined || d.lastName !== undefined)) {
      d.name = [d.firstName, d.lastName].filter(Boolean).join(" ");
    }
    if (d._id && d.id === undefined) d.id = String(d._id);
  }
}
employeeSchema.post("find", addLeanVirtuals);
employeeSchema.post("findOne", addLeanVirtuals);

// speeds up the most common filters (reports, dashboards, scope lookups)
employeeSchema.index({ group: 1 });

// ---- bonus area (Tbilisi / region) ----
// anything but "region" is Tbilisi (an empty form field too)
const normArea = (v) => (v === "region" ? "region" : "tbilisi");

// a rep moved between Tbilisi and region -> their bonuses are recalculated (from October 2026 on)
async function restampArea(employeeId) {
  try {
    const { restampBonuses, DEFAULT_FROM } = await import("../utils/bonuses.js");
    const now = new Date();
    for (let t = DEFAULT_FROM.y * 12 + DEFAULT_FROM.m; t <= now.getFullYear() * 12 + now.getMonth(); t++) {
      await restampBonuses({ y: Math.floor(t / 12), m: t % 12 }, { employees: [employeeId] });
    }
  } catch (err) {
    console.error("area restamp failed:", err);
  }
}

employeeSchema.pre("validate", function () {
  this.area = normArea(this.area);
});
employeeSchema.pre("save", function () {
  this.$locals.areaChanged = !this.isNew && this.isModified("area");
});
employeeSchema.post("save", function (doc) {
  if (doc.$locals?.areaChanged) restampArea(doc._id);
});
employeeSchema.pre("findOneAndUpdate", async function () {
  const u = this.getUpdate() || {};
  const inSet = u.$set && "area" in u.$set;
  if (!inSet && !("area" in u)) return;
  const next = normArea(inSet ? u.$set.area : u.area);
  if (inSet) u.$set.area = next; else u.area = next;
  const old = await this.model.findOne(this.getQuery()).select("area").lean();
  if (old && normArea(old.area) !== next) this._areaChangedId = old._id;
});
employeeSchema.post("findOneAndUpdate", function () {
  if (this._areaChangedId) restampArea(this._areaChangedId);
});

invalidateCachesOnWrite(employeeSchema);

export default mongoose.model("Employee", employeeSchema);
