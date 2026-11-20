import express from "express";
import { getZonalSales, getZonalDivisions, getZonalSummary } from "./zonalSales.controller.js";

const router = express.Router();
router.get("/divisions", getZonalDivisions);
router.get("/summary", getZonalSummary);
router.get("/", getZonalSales);
export default router;
