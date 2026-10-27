import express from "express";
import {
  listSheets, updateSheet, getGrid, setCell, exportSheet,
  availableEmployees, addMember, updateMember, moveMember, removeMember,
} from "./timesheet.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/sheets", listSheets);
router.put("/sheets/:key", updateSheet);
router.get("/grid", getGrid);
router.put("/cell", setCell);
router.get("/export", exportSheet);
router.get("/available-employees", availableEmployees);
router.post("/members", addMember);
router.put("/members/:id", updateMember);
router.post("/members/:id/move", moveMember);
router.delete("/members/:id", removeMember);
export default router;
