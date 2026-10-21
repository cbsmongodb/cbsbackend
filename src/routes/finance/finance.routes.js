import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import { getFinanceSummary } from "./finance.controller.js";

const router = express.Router();
router.use(requireAuth);
router.get("/summary", getFinanceSummary);
export default router;
