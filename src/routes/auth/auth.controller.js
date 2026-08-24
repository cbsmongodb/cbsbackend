import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Employee from "../../models/Employee.js";


function signToken(employee) {
  return jwt.sign({ id: employee._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const employee = await Employee.findOne({ email: email.toLowerCase() })
      .select("+password")
      .populate("role");

    if (!employee || !employee.active) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, employee.password);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken(employee);
    const { password: _pw, ...safeEmployee } = employee.toObject();

    res.json({ token, employee: safeEmployee });
  } catch (err) {
    console.error("login failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// Employees don't self-register per your earlier note — an admin creates
// them. This lives under admin/employees, not here; this endpoint just
// returns whoever the current token belongs to.
export async function me(req, res) {
  res.json(req.employee);
}

export async function logout(req, res) {
  // stateless JWT — logout is a client-side token removal. This endpoint
  // exists so the frontend has a consistent call to make (and a natural
  // place to blacklist tokens later, if that's ever needed).
  res.json({ success: true });
}

// logged-in employee changes their own password — requires the current
// one, so a stolen/left-open session can't silently lock the real owner out
export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const employee = await Employee.findById(req.employee._id).select("+password");
    const valid = await bcrypt.compare(currentPassword, employee.password);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    employee.password = await bcrypt.hash(newPassword, 10);
    await employee.save();

    res.json({ success: true });
  } catch (err) {
    console.error("changePassword failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
