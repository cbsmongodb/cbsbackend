import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import { getPrescriptionsReport, getPrescriptionsFilters } from "./prescriptionsReport.controller.js";

const router = express.Router();
router.get("/filters", requireAuth, getPrescriptionsFilters);
router.get("/", requireAuth, getPrescriptionsReport);
export default router;
