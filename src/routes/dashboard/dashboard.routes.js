import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import { getManagerStats } from "./managerStats.controller.js";

const router = express.Router();
router.use(requireAuth);
router.get("/manager-stats", getManagerStats);

export default router;
