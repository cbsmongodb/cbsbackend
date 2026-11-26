import express from "express";
import { getEfficiencyReport, getEfficiencyFilters } from "./reports.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/filters", requireAuth, getEfficiencyFilters);
router.get("/", requireAuth, getEfficiencyReport);
export default router;
