import mongoose from "mongoose";
import ErrorLog from "../models/ErrorLog.js";

// Intercepts every existing console.error(...) call across the whole
// backend (there are dozens, one per controller's catch block) and mirrors
// it into a small, auto-expiring ErrorLog collection — so a developer
// dashboard can surface "what broke recently" without touching every
// individual catch block.
const originalConsoleError = console.error.bind(console);

console.error = (...args) => {
  originalConsoleError(...args);

  try {
    if (mongoose.connection.readyState !== 1) return; // not connected yet — skip silently
    const message = args
      .map((a) => (a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")
      .slice(0, 2000); // guard against runaway size
    ErrorLog.create({ message }).catch(() => {}); // fire-and-forget, never throw from here
  } catch {
    // swallow — logging must never crash the app
  }
};
