import express from "express";
import { getLeavePayrollReport, getLeavePayrollDivisions } from "./leavePayroll.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/divisions", requireAuth, getLeavePayrollDivisions);
router.get("/", requireAuth, getLeavePayrollReport);
export default router;
