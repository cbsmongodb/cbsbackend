import express from "express";
import { getAttendanceReport } from "./reports.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.get("/", requireAuth, getAttendanceReport);
export default router;
