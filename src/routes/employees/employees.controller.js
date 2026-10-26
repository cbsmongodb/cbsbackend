import bcrypt from "bcryptjs";
import Employee from "../../models/Employee.js";
import Role from "../../models/Role.js";
import Designation from "../../models/Designation.js";
import Group from "../../models/Group.js";
import { getVisibleEmployeeIds, seesEverything } from "../../utils/groupVisibility.js";
import { bumpCacheVersion } from "../../utils/cacheBus.js";

// optional ObjectId-ref fields (group) arrive as "" from an
// unselected <select> — Mongoose can't cast an empty string to ObjectId,
// which threw an uncaught CastError and surfaced as a generic 500.
// Convert "" to null so leaving them unselected actually works.
const NULLABLE_REF_FIELDS = ["group"];
function sanitizeRefFields(body) {
  const clean = { ...body };
  NULLABLE_REF_FIELDS.forEach((key) => {
    if (clean[key] === "") clean[key] = null;
  });
  return clean;
}

const POPULATE = "role designation group";
// lists only need the role's NAME — not its whole privileges map for every row
const LIST_POPULATE = [
  { path: "role", select: "name" },
  { path: "designation" },
  { path: "group", select: "name section region head isActive" },
];

export async function getAllEmployees(req, res) {
  try {
    const { page, limit, division, group, search } = req.query;

    // dashboard filters: ?division=&group=&search= — "division" here is
    // really a Section id (Section IS the division; there is no separate
    // Division model anymore). We resolve it to that section's groups and
    // filter employees by group membership.
    const filter = {};
    if (division) {
      const groupIds = await Group.find({ section: division }).distinct("_id");
      filter.group = { $in: groupIds };
    }
    if (group) filter.group = group;
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      filter.$or = [{ firstName: regex }, { lastName: regex }];
    }

    // group/section-scoped visibility — admins see everyone; a Section head
    // (Division Manager) sees their section's groups; a Group head sees
    // their own group; everyone else sees only themselves
    const isAdmin = seesEverything(req.employee);
    if (!isAdmin) {
      const visibleIds = await getVisibleEmployeeIds(req.employee);
      filter._id = { $in: visibleIds };
    }

    // ?lite=1 -> just names for dropdowns (no role / group / designation)
    if (req.query.lite) {
      const employees = await Employee.find(filter).select("firstName lastName isActive").sort({ firstName: 1 }).lean();
      return res.json(employees);
    }

    if (!page && !limit) {
      const employees = await Employee.find(filter).populate(LIST_POPULATE).sort({ firstName: 1 }).lean();
      return res.json(employees);
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      Employee.find(filter).populate(LIST_POPULATE).sort({ firstName: 1 }).skip(skip).limit(limitNum).lean(),
      Employee.countDocuments(filter),
    ]);

    res.json({
      docs,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAllEmployees failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getEmployee(req, res) {
  try {
    const employee = await Employee.findById(req.params.id).populate(POPULATE).lean();
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    res.json(employee);
  } catch (err) {
    console.error("getEmployee failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// admin-only — this is how employees get an account (no self sign-up)
export async function createEmployee(req, res) {
  try {
    const { password, ...rest } = sanitizeRefFields(req.body);
    if (!password) return res.status(400).json({ error: "Password is required" });

    const hashed = await bcrypt.hash(password, 10);
    const employee = await Employee.create({ ...rest, password: hashed });

    const { password: _pw, ...safe } = employee.toObject();
    res.status(201).json(safe);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "An employee with this email already exists" });
    }
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("createEmployee failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateEmployee(req, res) {
  try {
    const { password, ...rest } = sanitizeRefFields(req.body);
    const update = { ...rest };
    if (password) update.password = await bcrypt.hash(password, 10);

    const employee = await Employee.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    }).populate(POPULATE);

    if (!employee) return res.status(404).json({ error: "Employee not found" });
    res.json(employee);
  } catch (err) {
    console.error("updateEmployee failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function bulkImportEmployees(req, res) {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "rows must be a non-empty array" });
    }

    // everything the import needs, loaded ONCE (roles / designations are tiny lists)
    // instead of 2-4 database round trips per row
    const emails = [...new Set(rows.map((r) => (r.email || "").trim().toLowerCase()).filter(Boolean))];
    const [roles, designations, existingList] = await Promise.all([
      Role.find().select("_id name").lean(),
      Designation.find().select("_id position").lean(),
      Employee.find({ email: { $in: emails } }).select("_id email").lean(),
    ]);
    const roleByName = new Map(roles.map((r) => [String(r.name || "").toLowerCase(), r._id]));
    const designationByName = new Map(designations.map((d) => [String(d.position || "").toLowerCase(), d._id]));
    const existingByEmail = new Map(existingList.map((e) => [e.email, e._id]));

    // the default password is the same for everyone -> hash it once, not per row
    // (bcrypt is deliberately slow: ~0.1s of CPU each time)
    let defaultHash = null;

    let created = 0;
    let updated = 0;
    let failed = 0;
    const failedRows = [];
    const updates = new Map(); // existing employee id -> $set
    const inserts = new Map(); // email -> new employee doc (same email twice -> later row wins, like before)

    for (const row of rows) {
      const name = (row.name || "").trim();
      const email = (row.email || "").trim().toLowerCase();
      const designationName = (row.designation || "").trim();
      const phoneNumber = (row.phoneNumber || "").trim();
      const status = (row.status || "").trim().toLowerCase();

      if (!name || !email) continue;

      const nameParts = name.split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(" ");

      const roleKey = designationName.toLowerCase();
      const roleId = roleByName.get(roleKey) || null;
      if (!roleId) {
        failed++;
        failedRows.push({ name, reason: `No matching role found: "${designationName}"` });
        continue;
      }
      const designationId = designationByName.get(roleKey) || null;

      const existingId = existingByEmail.get(email);
      if (existingId) {
        const set = { firstName, lastName, phoneNumber, role: roleId, isActive: status === "active" };
        if (designationId) set.designation = designationId;
        updates.set(String(existingId), { ...(updates.get(String(existingId)) || {}), ...set });
        updated++;
        continue;
      }
      if (inserts.has(email)) {
        // same new email again in this paste -> update the pending new employee
        const doc = inserts.get(email);
        Object.assign(doc, { firstName, lastName, phoneNumber, role: roleId, isActive: status === "active" });
        if (designationId) doc.designation = designationId;
        updated++;
        continue;
      }

      if (!defaultHash) defaultHash = await bcrypt.hash("123456", 10);
      inserts.set(email, {
        firstName,
        lastName,
        email,
        phoneNumber,
        password: defaultHash,
        role: roleId,
        designation: designationId,
        isActive: status === "active",
      });
      created++;
    }

    if (updates.size) {
      await Employee.bulkWrite(
        [...updates].map(([id, set]) => ({ updateOne: { filter: { _id: id }, update: { $set: set } } }))
      );
    }
    if (inserts.size) await Employee.insertMany([...inserts.values()]);
    bumpCacheVersion(); // bulkWrite skips middleware -> clear auth / visibility caches ourselves

    res.json({ created, updated, failed, failedRows });
  } catch (err) {
    console.error("bulkImportEmployees failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteEmployee(req, res) {
  try {
    const employee = await Employee.findByIdAndDelete(req.params.id);
    if (!employee) return res.status(404).json({ error: "Employee not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteEmployee failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
