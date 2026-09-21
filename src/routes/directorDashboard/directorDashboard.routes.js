import express from "express";
import { getProductSale, getStockAvailability, getOrders, getDoctorsReport } from "./directorDashboard.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/product-sale", getProductSale);
router.get("/stock-availability", getStockAvailability);
router.get("/orders", getOrders);
router.get("/doctors-report", getDoctorsReport);
export default router;
