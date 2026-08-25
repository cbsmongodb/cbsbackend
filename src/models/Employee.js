import mongoose from "mongoose";

const employeeSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, default: "" },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, select: false },

    username: String,
    personnelNumber: String,
    phoneNumber: String,
    note: String,
    avatarUrl: String,

    employeeType: { type: String, enum: ["field", "office"], default: "field" },

    designation: { type: mongoose.Schema.Types.ObjectId, ref: "Designation", default: null },
    role: { type: mongoose.Schema.Types.ObjectId, ref: "Role", required: true },

    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null },
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", default: null },

    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

employeeSchema.virtual("name").get(function () {
  return [this.firstName, this.lastName].filter(Boolean).join(" ");
});
employeeSchema.set("toJSON", { virtuals: true });

export default mongoose.model("Employee", employeeSchema);
