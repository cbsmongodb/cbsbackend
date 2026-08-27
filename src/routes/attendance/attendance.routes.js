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

// exported as a function because markAttendance needs the io instance —
// mounted in app.js as: app.use("/api/attendance", attendanceRoutes(io))
export default function attendanceRoutes(io) {
  const router = express.Router();
  router.use(requireAuth);

  router.post("/current-location", setCurrentLocation);
  router.get("/current-locations", getCurrentLocations);

  router.post("/mark", markAttendance(io));
  router.get("/live-feed", getLiveFeed);
  router.get("/daily-status", getDailyStatus);
  router.get("/employee-day", getEmployeeDay);
  router.get("/my-status", getMyStatus);

  return router;
}
