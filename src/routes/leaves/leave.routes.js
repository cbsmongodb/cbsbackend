import express from "express";
import {
  getBalance,
  setBalance,
  getAllEntries,
  createEntry,
  deleteEntry,
  getRestDays,
  createRestDay,
  deleteRestDay,
} from "./leave.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

router.get("/balance", getBalance);
router.post("/balance", setBalance);

router.get("/", getAllEntries);
router.post("/", createEntry);
router.delete("/:id", deleteEntry);

router.get("/rest-days", getRestDays);
router.post("/rest-days", createRestDay);
router.delete("/rest-days/:id", deleteRestDay);

export default router;
