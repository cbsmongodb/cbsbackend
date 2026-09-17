import express from "express";
import {
  getAllPrescriptions,
  toggleActive,
  deletePrescription,
  createPrescription,
  getPrescriptionById,
  addDrugDetails,
  removeDrugPrescription,
  updateDrugPrescriptionSaleBoxes,
} from "./prescriptions.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", getAllPrescriptions);
router.post("/", createPrescription);
router.get("/:id", getPrescriptionById);
router.put("/:id/toggle-active", toggleActive);
router.delete("/:id", deletePrescription);

router.post("/:id/drugs", addDrugDetails);
router.delete("/:id/drugs/:drugPrescriptionId", removeDrugPrescription);

router.put("/drug-lines/:id", updateDrugPrescriptionSaleBoxes);

export default router;
