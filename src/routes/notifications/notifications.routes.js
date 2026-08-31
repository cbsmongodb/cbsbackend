import express from "express";
import {
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  clearAll,
  sendTestNotification,
} from "./notifications.controller.js";
import { requireAuth } from "../../middleware/auth.js";

export default function notificationsRoutes(io) {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/", getMyNotifications);
  router.post("/read-all", markAllAsRead);
  router.post("/:id/read", markAsRead);
  router.delete("/", clearAll);
  router.post("/send-test", sendTestNotification(io));

  return router;
}
