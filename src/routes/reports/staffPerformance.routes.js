import express from "express";
import { getStaffPerformanceReport } from "./reports.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/", requireAuth, getStaffPerformanceReport);
export default router;
