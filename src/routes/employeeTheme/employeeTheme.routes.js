import express from "express";
import { getMyTheme } from "./employeeTheme.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
router.get("/", getMyTheme);
export default router;
