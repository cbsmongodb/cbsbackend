import jwt from "jsonwebtoken";
import Employee from "../models/Employee.js";

const METHOD_TO_ACTION = { GET: "read", POST: "add", PUT: "update", PATCH: "update", DELETE: "delete" };

export function requirePermission(resourceKey) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : null;
      if (!token) return res.status(401).json({ error: "Not authenticated" });

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const employee = await Employee.findById(payload.id).populate("role");
      if (!employee || !employee.isActive) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const action = METHOD_TO_ACTION[req.method] || "read";

      if (employee.role?.name === "admin") {
        req.employee = employee;
        return next();
      }

      const resourceAccess = employee.role?.privileges?.[resourceKey];

      if (!resourceAccess || resourceAccess[action] !== 1) {
        return res.status(403).json({ error: "Forbidden" });
      }

      req.employee = employee;
      next();
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
