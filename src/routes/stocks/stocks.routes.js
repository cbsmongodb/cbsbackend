import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import { preview, commit, listPeriods, getPeriod } from "./stocks.controller.js";

// mounted in app.js behind requirePermission("stock_upload"):
// GET needs read, POST needs add
const router = express.Router();
router.use(requireAuth);

router.get("/periods", listPeriods);
router.get("/period/:period", getPeriod);
router.post("/preview", preview);
router.post("/commit", commit);

export default router;
