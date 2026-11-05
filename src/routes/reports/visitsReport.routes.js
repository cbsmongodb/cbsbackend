import express from "express";
import { getVisitsReport, getVisitsDivisions } from "./visitsReport.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/divisions", requireAuth, getVisitsDivisions);
router.get("/", requireAuth, getVisitsReport);
export default router;
