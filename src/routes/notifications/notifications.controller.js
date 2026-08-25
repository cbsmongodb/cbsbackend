import Notification from "../../models/Notification.js";

export async function getMyNotifications(req, res) {
  try {
    const notifications = await Notification.find({ employee: req.employee._id }).sort({
      read: 1,
      createdAt: -1,
    });
    res.json(notifications);
  } catch (err) {
    console.error("getMyNotifications failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function markAsRead(req, res) {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, employee: req.employee._id },
      { read: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ error: "Not found" });
    res.json(notification);
  } catch (err) {
    console.error("markAsRead failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function markAllAsRead(req, res) {
  try {
    await Notification.updateMany({ employee: req.employee._id, read: false }, { read: true });
    res.json({ success: true });
  } catch (err) {
    console.error("markAllAsRead failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function clearAll(req, res) {
  try {
    await Notification.deleteMany({ employee: req.employee._id });
    res.json({ success: true });
  } catch (err) {
    console.error("clearAll failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
