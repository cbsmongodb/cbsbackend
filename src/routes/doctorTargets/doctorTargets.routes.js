import express from "express";
import { getAllDoctorTargets, deleteDoctorTarget } from "./doctorTargets.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllDoctorTargets);
router.delete("/:id", deleteDoctorTarget);
export default router;
