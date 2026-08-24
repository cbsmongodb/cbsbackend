import express from "express";
import {
  getAllSalesEntries,
  createSalesEntry,
  updateSalesEntry,
  deleteSalesEntry,
} from "./salesEntries.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", getAllSalesEntries);
router.post("/", createSalesEntry);
router.put("/:id", updateSalesEntry);
router.delete("/:id", deleteSalesEntry);

export default router;
