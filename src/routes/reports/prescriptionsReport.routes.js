import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import { getPrescriptionsReport } from "./prescriptionsReport.controller.js";

const router = express.Router();
router.get("/", requireAuth, getPrescriptionsReport);
export default router;
