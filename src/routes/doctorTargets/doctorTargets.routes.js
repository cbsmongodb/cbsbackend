import express from "express";
import { getAllDoctorTargets,
  createDoctorTarget,
  getVisibleDrugsForDoctorTarget, deleteDoctorTarget } from "./doctorTargets.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllDoctorTargets,
  createDoctorTarget,
  getVisibleDrugsForDoctorTarget);
router.delete("/:id", deleteDoctorTarget);
router.get("/visible-drugs", getVisibleDrugsForDoctorTarget);
router.post("/", createDoctorTarget);

export default router;
