import express from "express";
import {
  getAllPlannings,
  getPlanning,
  createPlanning,
  updatePlanning,
  deletePlanning,
  addDoctor,
  removeDoctor,
  checkIn,
  checkOut,
  doctorsForPlanHospital,
} from "./planning.controller.js";
import { requireAuth } from "../../middleware/auth.js";

// exported as a function — checkIn/checkOut need the io instance to
// broadcast to Live Feed, same pattern as attendance.routes.js
export default function planningsRoutes(io) {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/", getAllPlannings);
  router.post("/", createPlanning);
  router.get("/:id", getPlanning);
  router.put("/:id", updatePlanning);
  router.delete("/:id", deletePlanning);

  router.post("/:id/doctors", addDoctor);
  router.delete("/:id/doctors/:pcdId", removeDoctor);
  router.get("/:id/doctors-available", doctorsForPlanHospital);

  router.post("/:id/checkin", checkIn(io));
  router.post("/:id/checkout", checkOut(io));

  return router;
}
