import express from "express";
import { getRecentErrors, markAllRead } from "./devErrors.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", getRecentErrors);
router.put("/mark-read", markAllRead);

export default router;
