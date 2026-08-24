import express from "express";
import { login, me, logout, changePassword } from "./auth.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();

router.post("/login", login);
router.post("/logout", logout);
router.get("/me", requireAuth, me);
router.patch("/change-password", requireAuth, changePassword);

export default router;
