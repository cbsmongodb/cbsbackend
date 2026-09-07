import express from "express";
import { getReimbursementReport, exportReimbursementReport } from "./reports.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/export", requireAuth, exportReimbursementReport);
router.get("/", requireAuth, getReimbursementReport);
export default router;
