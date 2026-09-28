import express from "express";
import { getAllDoctorTargets,
  createDoctorTarget,
  getVisibleDrugsForDoctorTarget,
  getDoctorTargetById,
  updateDoctorTarget, deleteDoctorTarget } from "./doctorTargets.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllDoctorTargets,
  createDoctorTarget,
  getVisibleDrugsForDoctorTarget,
  getDoctorTargetById,
  updateDoctorTarget);
router.delete("/:id", deleteDoctorTarget);
router.get("/visible-drugs", getVisibleDrugsForDoctorTarget,
  getDoctorTargetById,
  updateDoctorTarget);
router.post("/", createDoctorTarget);
router.get("/:id", getDoctorTargetById);
router.put("/:id", updateDoctorTarget);

export default router;
