import Notification from "../../models/Notification.js";
import Employee from "../../models/Employee.js";

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

// Creates a notification for a target employee (by email) and emits it in
// real time over socket.io, so connected clients update instantly instead
// of waiting for their next poll. Used for manual/test notifications, and
// is the pattern real triggers (stock alerts, budget approvals, etc.)
// should eventually use too.
export function sendTestNotification(io) {
  return async (req, res) => {
    try {
      const { targetEmail, notifiableType, message } = req.body;
      if (!targetEmail || !notifiableType || !message) {
        return res.status(400).json({ error: "targetEmail, notifiableType, and message are required" });
      }

      const validTypes = ["Task", "BudgetRequest", "BudgetRequird", "StockAlert"];
      if (!validTypes.includes(notifiableType)) {
        return res.status(400).json({ error: `notifiableType must be one of: ${validTypes.join(", ")}` });
      }

      const employee = await Employee.findOne({ email: targetEmail.toLowerCase() });
      if (!employee) return res.status(404).json({ error: "No employee found with that email" });

      const notification = await Notification.create({
        employee: employee._id,
        notifiableType,
        notifiableId: employee._id,
        message,
        read: false,
      });

      if (io) {
        io.emit("notification:new", {
          employeeId: String(employee._id),
          notification,
        });
      }

      res.status(201).json(notification);
    } catch (err) {
      console.error("sendTestNotification failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  };
}
