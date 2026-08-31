// Creates a test notification for a given employee, so you can see the
// Notifications page with real data before any real event (stock alert,
// budget request, etc.) has fired.
//
// Usage:
//   node src/scripts/createTestNotification.js "email@example.com" "StockAlert" "ტესტ შეტყობინების ტექსტი"
//
// notifiableType must be one of: Task, BudgetRequest, BudgetRequird, StockAlert
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import Employee from "../models/Employee.js";
import Notification from "../models/Notification.js";

async function run() {
  const [email, notifiableType, message] = process.argv.slice(2);

  if (!email || !notifiableType || !message) {
    console.error(
      'Usage: node src/scripts/createTestNotification.js "email@example.com" "StockAlert" "message text"'
    );
    console.error("notifiableType must be one of: Task, BudgetRequest, BudgetRequird, StockAlert");
    process.exit(1);
  }

  const validTypes = ["Task", "BudgetRequest", "BudgetRequird", "StockAlert"];
  if (!validTypes.includes(notifiableType)) {
    console.error(`notifiableType must be one of: ${validTypes.join(", ")}`);
    process.exit(1);
  }

  await connectDB();

  const employee = await Employee.findOne({ email: email.toLowerCase() });
  if (!employee) {
    console.error(`No employee found with email ${email}`);
    process.exit(1);
  }

  const notification = await Notification.create({
    employee: employee._id,
    notifiableType,
    notifiableId: employee._id,
    message,
    read: false,
  });

  console.log(`Created notification ${notification._id} for ${employee.email}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
