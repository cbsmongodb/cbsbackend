import express from "express";
import { getReimbursementReport } from "./reports.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/", requireAuth, getReimbursementReport);
export default router;
