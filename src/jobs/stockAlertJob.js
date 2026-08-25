import Drug from "../models/Drug.js";
import Role from "../models/Role.js";
import Employee from "../models/Employee.js";
import Notification from "../models/Notification.js";

export async function runStockAlertJob() {
  try {
    const lowStock = await Drug.checkLowStock();
    const expired = await Drug.checkExpiredDrugs();

    if (lowStock.length === 0 && expired.length === 0) {
      console.log("[stockAlertJob] nothing to report today");
      return;
    }

    const rolesWithDrugAccess = await Role.find({ "privileges.drugs.read": 1 });
    const roleIds = rolesWithDrugAccess.map((r) => r._id);
    const recipients = await Employee.find({ role: { $in: roleIds }, isActive: true });

    const messageParts = [];
    if (lowStock.length > 0) {
      messageParts.push(
        `Low stock: ${lowStock.map((d) => `${d.name} (${d.stock})`).join(", ")}`
      );
    }
    if (expired.length > 0) {
      messageParts.push(`Expired: ${expired.map((d) => d.name).join(", ")}`);
    }
    const message = messageParts.join(" | ");

    await Promise.all(
      recipients.map((employee) =>
        Notification.create({
          employee: employee._id,
          notifiableType: "StockAlert",
          notifiableId: employee._id,
          message: `Daily stock alert: ${message}`,
        })
      )
    );

    console.log(
      `[stockAlertJob] notified ${recipients.length} employees — ${lowStock.length} low stock, ${expired.length} expired`
    );
  } catch (err) {
    console.error("[stockAlertJob] failed:", err);
  }
}
