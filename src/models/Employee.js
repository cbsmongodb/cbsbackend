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

    // Rails: enum employee_type: { field: 0, office: 1 }
    employeeType: { type: String, enum: ["field", "office"], default: "field" },

    designation: { type: mongoose.Schema.Types.ObjectId, ref: "Designation", required: true },
    // many-to-many in Rails via employee_roles — plain array here
    roles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],

    // convenience denormalized links (Rails derives these through
    // EmployeeGroup / Section.head_id / Group.head_id instead)
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null },
    division: { type: mongoose.Schema.Types.ObjectId, ref: "Division", default: null },

    isActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Rails: def name -> "#{first_name} #{last_name}".squish
employeeSchema.virtual("name").get(function () {
  return [this.firstName, this.lastName].filter(Boolean).join(" ");
});
employeeSchema.set("toJSON", { virtuals: true });

export default mongoose.model("Employee", employeeSchema);
