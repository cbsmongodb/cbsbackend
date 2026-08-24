import express from "express";
import {
  getAllBudgets,
  createBudget,
  updateBudget,
  deleteBudget,
  getBudgetAllotment,
} from "./budget.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

router.get("/allotment", getBudgetAllotment);
router.get("/", getAllBudgets);
router.post("/", createBudget);
router.put("/:id", updateBudget);
router.delete("/:id", deleteBudget);

export default router;
