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
  getVisitDurations,
} from "./planning.controller.js";
import { requireAuth } from "../../middleware/auth.js";

export default function planningsRoutes(io) {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/", getAllPlannings);
  router.post("/", createPlanning);

  router.get("/visit-durations", getVisitDurations);

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
