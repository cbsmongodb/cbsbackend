import express from "express";
import { getVisitsReport, getVisitsDivisions, getVisitsEmployees } from "./visitsReport.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/divisions", requireAuth, getVisitsDivisions);
router.get("/employees", requireAuth, getVisitsEmployees);
router.get("/", requireAuth, getVisitsReport);
export default router;
