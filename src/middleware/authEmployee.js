import jwt from "jsonwebtoken";
import Employee from "../models/Employee.js";
import { createCache } from "../utils/cacheBus.js";

// Every API request used to load the logged-in employee + role from MongoDB
// (and often twice: requireAuth AND requirePermission). That's 2-4 database
// round trips before the real work even starts. Cache it for 30s per user;
// any write to Employee/Role invalidates the cache instantly (see cacheBus).
const cached = createCache(30_000);

async function loadEmployee(id) {
  const emp = await cached(String(id), () =>
    Employee.findById(id).populate("role").lean() // lean hook adds name / id
  );
  // shallow copy per request, so nothing can leak between requests
  return emp ? { ...emp } : null;
}

// returns the active employee for the request's Bearer token, or null
export async function employeeFromRequest(req) {
  if (req.employee) return req.employee; // already resolved earlier in this request
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  const payload = jwt.verify(token, process.env.JWT_SECRET); // throws on bad / expired token
  const employee = await loadEmployee(payload.id);
  if (!employee || !employee.isActive) return null;
  return employee;
}
