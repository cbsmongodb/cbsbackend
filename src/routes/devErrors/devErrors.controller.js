import ErrorLog from "../../models/ErrorLog.js";

const DEVELOPER_EMAIL = "lbogveradze12@gmail.com";

function requireDeveloper(req, res) {
  if (req.employee?.email?.toLowerCase() !== DEVELOPER_EMAIL) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// GET /api/dev/errors — most recent 30, newest first
export async function getRecentErrors(req, res) {
  if (!requireDeveloper(req, res)) return;
  try {
    const docs = await ErrorLog.find().sort({ createdAt: -1 }).limit(30);
    res.json(docs);
  } catch (err) {
    console.error("getRecentErrors failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// PUT /api/dev/errors/mark-read — marks all current errors as read (so the
// widget can show only *new* ones on the next visit, without deleting history)
export async function markAllRead(req, res) {
  if (!requireDeveloper(req, res)) return;
  try {
    await ErrorLog.updateMany({ read: false }, { read: true });
    res.json({ success: true });
  } catch (err) {
    console.error("markAllRead failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
