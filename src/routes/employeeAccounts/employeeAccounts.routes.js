import express from "express";
import { getAllEmployeeAccounts, deleteEmployeeAccount } from "./employeeAccounts.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllEmployeeAccounts);
router.delete("/:id", deleteEmployeeAccount);
export default router;
