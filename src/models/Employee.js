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

invalidateCachesOnWrite(employeeSchema);

export default mongoose.model("Employee", employeeSchema);
