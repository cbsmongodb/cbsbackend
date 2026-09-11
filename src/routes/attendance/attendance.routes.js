import express from "express";
import {
  setCurrentLocation,
  getCurrentLocations,
  markAttendance,
  getLiveFeed,
  getDailyStatus,
  getEmployeeDay,
  getMyStatus,
} from "./attendance.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/requirePermission.js";

// exported as a function because markAttendance needs the io instance —
// mounted in app.js as: app.use("/api/attendance", attendanceRoutes(io))
export default function attendanceRoutes(io) {
  const router = express.Router();
  router.use(requireAuth);

  // self-service actions — every employee needs these regardless of role,
  // so they stay open to any authenticated employee (not gated by "attendances")
  router.post("/current-location", setCurrentLocation);
  router.post("/mark", markAttendance(io));
  router.get("/my-status", getMyStatus);

  // viewing OTHER employees' attendance/location — requires the
  // "attendances" permission, same key the Live Feed / Team Status /
  // Attendance Report sidebar links already check
  router.get("/current-locations", requirePermission("attendances"), getCurrentLocations);
  router.get("/live-feed", requirePermission("attendances"), getLiveFeed);
  router.get("/daily-status", requirePermission("attendances"), getDailyStatus);
  router.get("/employee-day", requirePermission("attendances"), getEmployeeDay);

  return router;
}
