import express from "express";
import { getAllEmployeeTargets, deleteEmployeeTarget } from "./employeeTargets.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllEmployeeTargets);
router.delete("/:id", deleteEmployeeTarget);
export default router;
