import express from "express";
import { getAllPrescriptions, toggleActive, deletePrescription } from "./prescriptions.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAllPrescriptions);
router.put("/:id/toggle-active", toggleActive);
router.delete("/:id", deletePrescription);
export default router;
