import express from "express";
import {
  getAllBudgetRequireds,
  getBudgetRequird,
  createBudgetRequird,
  updateBudgetRequird,
  updateBudgetRequirdStatus,
  getAllBudgetRequests,
  updateFinanceStatus,
} from "./budgetWorkflow.controller.js";
import { requireAuth } from "../../middleware/auth.js";

export const budgetRequirdRoutes = express.Router();
budgetRequirdRoutes.use(requireAuth);
budgetRequirdRoutes.get("/", getAllBudgetRequireds);
budgetRequirdRoutes.post("/", createBudgetRequird);
budgetRequirdRoutes.get("/:id", getBudgetRequird);
budgetRequirdRoutes.put("/:id", updateBudgetRequird);
budgetRequirdRoutes.post("/:id/status", updateBudgetRequirdStatus);

export const budgetRequestRoutes = express.Router();
budgetRequestRoutes.use(requireAuth);
budgetRequestRoutes.get("/", getAllBudgetRequests);
budgetRequestRoutes.post("/:id/finance-status", updateFinanceStatus);
