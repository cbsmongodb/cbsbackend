import express from "express";
import { getAllEmployeeTargets,
  createEmployeeTarget,
  getVisibleDrugsForTarget, deleteEmployeeTarget } from "./employeeTargets.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllEmployeeTargets,
  createEmployeeTarget,
  getVisibleDrugsForTarget);
router.delete("/:id", deleteEmployeeTarget);
router.get("/visible-drugs", getVisibleDrugsForTarget);
router.post("/", createEmployeeTarget);

export default router;
