import express from "express";
import { getReimbursementReport, exportReimbursementReport, getReimbursementDivisions } from "./reports.controller.js";
import { requireAuth } from "../../middleware/auth.js";
import { exportExpensesWorkbook } from "./expenses.controller.js";

const router = express.Router();
router.get("/export", requireAuth, exportReimbursementReport);
router.get("/expenses", requireAuth, exportExpensesWorkbook);
router.get("/divisions", requireAuth, getReimbursementDivisions);
router.get("/", requireAuth, getReimbursementReport);
export default router;
