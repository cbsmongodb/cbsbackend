import express from "express";
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  clearAll,
} from "./notifications.controller.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", getMyNotifications);
router.post("/read-all", markAllAsRead);
router.post("/:id/read", markAsRead);
router.delete("/", clearAll);

export default router;
