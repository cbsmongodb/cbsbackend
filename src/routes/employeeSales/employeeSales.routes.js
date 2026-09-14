import express from "express";
import { getAllEmployeeSales, deleteEmployeeSale } from "./employeeSales.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllEmployeeSales);
router.delete("/:id", deleteEmployeeSale);
export default router;
