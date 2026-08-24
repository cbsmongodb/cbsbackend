import express from "express";
import {
  getAllEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
} from "./employees.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", getAllEmployees);
router.get("/:id", getEmployee);
router.post("/", createEmployee);
router.put("/:id", updateEmployee);
router.delete("/:id", deleteEmployee);

export default router;
