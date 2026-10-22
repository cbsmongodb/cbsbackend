import express from "express";
import { getReimbursementReport, exportReimbursementReport, getReimbursementDivisions } from "./reports.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/export", requireAuth, exportReimbursementReport);
router.get("/divisions", requireAuth, getReimbursementDivisions);
router.get("/", requireAuth, getReimbursementReport);
export default router;
