import express from "express";
import { getAnalytics } from "./analytics.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getAnalytics);
export default router;
