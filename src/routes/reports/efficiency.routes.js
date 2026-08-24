import express from "express";
import { getEfficiencyReport } from "./reports.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/", requireAuth, getEfficiencyReport);
export default router;
