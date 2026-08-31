import mongoose from "mongoose";

const permissionSchema = new mongoose.Schema(
  {
    read: { type: Number, default: 0 },
    add: { type: Number, default: 0 },
    update: { type: Number, default: 0 },
    delete: { type: Number, default: 0 },
    import: { type: Number, default: 0 },
    export: { type: Number, default: 0 },
    dashboard: { type: Number, default: 0 },
    live_feeds: { type: Number, default: 0 },
    last_locations: { type: Number, default: 0 },
    analytics: { type: Number, default: 0 },
  },
  { _id: false }
);

const roleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    // keyed by resource — e.g. privileges.hospitals.read, privileges.drugs.add
    privileges: { type: Map, of: permissionSchema, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("Role", roleSchema);
