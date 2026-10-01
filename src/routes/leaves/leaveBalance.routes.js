import express from "express";
import { getBalance } from "./leave.controller.js";
import { requireAuth } from "../../middleware/auth.js";

// Only the read-only "my own leave balance" endpoint, gated by auth alone
// (no "leaves" admin permission) so the dashboard works for every role.
const router = express.Router();
router.use(requireAuth);
router.get("/balance", getBalance);

export default router;
