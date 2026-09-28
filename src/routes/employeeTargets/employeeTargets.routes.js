import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  getAllEmployeeTargets,
  deleteEmployeeTarget,
  createEmployeeTarget,
  getVisibleDrugsForTarget,
  getEmployeeTargetById,
  updateEmployeeTarget,
} from "./employeeTargets.controller.js";

const router = express.Router();
router.use(requireAuth);

// static routes first
router.get("/", getAllEmployeeTargets);
router.get("/visible-drugs", getVisibleDrugsForTarget);
router.post("/", createEmployeeTarget);

// param routes last
router.get("/:id", getEmployeeTargetById);
router.put("/:id", updateEmployeeTarget);
router.delete("/:id", deleteEmployeeTarget);

export default router;
