import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  getAllEmployeeSales,
  deleteEmployeeSale,
  createEmployeeSale,
  getVisibleDrugsForSale,
  getEmployeeSaleById,
  updateEmployeeSale,
} from "./employeeSales.controller.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", getAllEmployeeSales);
router.get("/visible-drugs", getVisibleDrugsForSale);
router.post("/", createEmployeeSale);
router.get("/:id", getEmployeeSaleById);
router.put("/:id", updateEmployeeSale);
router.delete("/:id", deleteEmployeeSale);

export default router;
