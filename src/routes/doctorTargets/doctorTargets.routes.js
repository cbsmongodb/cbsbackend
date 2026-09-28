import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  getAllDoctorTargets,
  deleteDoctorTarget,
  createDoctorTarget,
  getVisibleDrugsForDoctorTarget,
  getDoctorTargetById,
  updateDoctorTarget,
} from "./doctorTargets.controller.js";

const router = express.Router();
router.use(requireAuth);

// static routes first
router.get("/", getAllDoctorTargets);
router.get("/visible-drugs", getVisibleDrugsForDoctorTarget);
router.post("/", createDoctorTarget);

// param routes last (so /visible-drugs isn't swallowed by /:id)
router.get("/:id", getDoctorTargetById);
router.put("/:id", updateDoctorTarget);
router.delete("/:id", deleteDoctorTarget);

export default router;
