import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import { getFinanceSummary, getFinanceDetails, getFinanceFilters } from "./finance.controller.js";

const router = express.Router();
router.use(requireAuth);
router.get("/summary", getFinanceSummary);
router.get("/details", getFinanceDetails);
router.get("/filters", getFinanceFilters);
export default router;
