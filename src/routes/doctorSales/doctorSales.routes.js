import express from "express";
import { getAllDoctorSales, deleteDoctorSale } from "./doctorSales.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllDoctorSales);
router.delete("/:id", deleteDoctorSale);
export default router;
