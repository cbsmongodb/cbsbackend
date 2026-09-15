import express from "express";
import { getAllBudgets, toggleBudgetActive, deleteBudget } from "./budgetsList.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllBudgets);
router.put("/:id/toggle-active", toggleBudgetActive);
router.delete("/:id", deleteBudget);
export default router;
