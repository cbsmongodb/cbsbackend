import bcrypt from "bcryptjs";
import Employee from "../../models/Employee.js";

const POPULATE = "role designation section group region division";

export async function getAllEmployees(req, res) {
  try {
    // dashboard filters: ?division=&group=&search=
    const filter = {};
    if (req.query.division) filter.division = req.query.division;
    if (req.query.group) filter.group = req.query.group;
    if (req.query.search) {
      filter.$or = [
        { firstName: new RegExp(req.query.search, "i") },
        { lastName: new RegExp(req.query.search, "i") },
      ];
    }

    const employees = await Employee.find(filter).populate(POPULATE).sort({ firstName: 1 });
    res.json(employees);
  } catch (err) {
    console.error("getAllEmployees failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getEmployee(req, res) {
  try {
    const employee = await Employee.findById(req.params.id).populate(POPULATE);
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
    const { password, ...rest } = req.body;
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
    const { password, ...rest } = req.body;
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
