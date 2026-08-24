import express from "express";
import {
  getListing,
  getDoctorSnapshot,
  submitEntries,
  updateEntryItem,
  deleteEntries,
} from "./doctorEntryItems.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", getListing);
router.get("/snapshot", getDoctorSnapshot);
router.post("/submit", submitEntries);
router.put("/:id", updateEntryItem);
router.delete("/", deleteEntries);

export default router;
