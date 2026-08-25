import jwt from "jsonwebtoken";
import Employee from "../models/Employee.js";

// verifies the JWT and attaches req.employee — every protected route
// after this point can trust req.employee is a real, logged-in user.
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Not authenticated" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const employee = await Employee.findById(payload.id).populate("role");
    if (!employee || !employee.isActive) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    req.employee = employee;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
