import { employeeFromRequest } from "./authEmployee.js";

// verifies the JWT and attaches req.employee — every protected route
// after this point can trust req.employee is a real, logged-in user.
export async function requireAuth(req, res, next) {
  try {
    const employee = await employeeFromRequest(req);
    if (!employee) return res.status(401).json({ error: "Not authenticated" });
    req.employee = employee;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
