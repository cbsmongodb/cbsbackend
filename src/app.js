import express from "express";
import cors from "cors";

import { requirePermission } from "./middleware/requirePermission.js";

import authRoutes from "./routes/auth/auth.routes.js";
import employeesRoutes from "./routes/employees/employees.routes.js";
import doctorsRoutes, {
  doctorCategoryRoutes,
  doctorSubcategoryRoutes,
} from "./routes/doctors/doctors.routes.js";
import hospitalsRoutes from "./routes/hospitals/hospitals.routes.js";
import pharmaciesRoutes from "./routes/pharmacies/pharmacies.routes.js";
import profilesRoutes from "./routes/profiles/profiles.routes.js";
import drugsRoutes, {
  productTypeRoutes,
  manufacturerRoutes,
  producingCountryRoutes,
} from "./routes/drugs/drugs.routes.js";
import salesEntriesRoutes from "./routes/sales/salesEntries.routes.js";
import doctorEntryItemsRoutes from "./routes/sales/doctorEntryItems.routes.js";
import budgetRoutes from "./routes/budget/budget.routes.js";
import { budgetRequirdRoutes, budgetRequestRoutes } from "./routes/budget/budgetWorkflow.routes.js";
import attendanceRoutes from "./routes/attendance/attendance.routes.js";
import planningsRoutes from "./routes/planAndPerform/plannings.routes.js";
import tasksRoutes from "./routes/planAndPerform/tasks.routes.js";
import efficiencyRoutes from "./routes/reports/efficiency.routes.js";
import reimbursementRoutes from "./routes/reports/reimbursement.routes.js";
import attendancesReportRoutes from "./routes/reports/attendances.routes.js";
import staffPerformanceRoutes from "./routes/reports/staffPerformance.routes.js";
import prescriptionsRoutes from "./routes/prescriptions/prescriptions.routes.js";
import employeeTargetsRoutes from "./routes/employeeTargets/employeeTargets.routes.js";
import employeeSalesRoutes from "./routes/employeeSales/employeeSales.routes.js";
import doctorSalesRoutes from "./routes/doctorSales/doctorSales.routes.js";
import doctorTargetsRoutes from "./routes/doctorTargets/doctorTargets.routes.js";
import employeeAccountsRoutes from "./routes/employeeAccounts/employeeAccounts.routes.js";
import analyticsRoutes from "./routes/analytics/analytics.routes.js";
import budgetsListRoutes from "./routes/budgetsList/budgetsList.routes.js";
import employeeThemeRoutes from "./routes/employeeTheme/employeeTheme.routes.js";
import {
  roleRoutes,
  designationRoutes,
  sectionRoutes,
  groupRoutes,
  regionRoutes,
} from "./routes/admin/admin.routes.js";
import divisionsRoutes from "./routes/divisions/divisions.routes.js";
import leaveRoutes from "./routes/leaves/leave.routes.js";
import notificationsRoutes from "./routes/notifications/notifications.routes.js";
import {
  planConfigRoutes,
  notificationConfigRoutes,
  batchConfigRoutes,
} from "./routes/config/config.routes.js";

export function createApp(io) {
  const app = express();

  const allowedOrigins = (process.env.CLIENT_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked for origin: ${origin}`));
      }
    },
    credentials: true,
  })
);
  app.use(express.json());

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRoutes);

  app.use("/api/employees/me/theme", employeeThemeRoutes);
  app.use("/api/employees", requirePermission("employees"), employeesRoutes);
  app.use("/api/admin/roles", requirePermission("roles"), roleRoutes);
  app.use("/api/admin/designations", requirePermission("designations"), designationRoutes);
  app.use("/api/admin/sections", requirePermission("sections"), sectionRoutes);
  app.use("/api/admin/groups", requirePermission("groups"), groupRoutes);
  app.use("/api/admin/regions", requirePermission("regions"), regionRoutes);
  app.use("/api/divisions", divisionsRoutes);

  app.use("/api/doctors", requirePermission("doctors"), doctorsRoutes);
  app.use("/api/doctor-categories", requirePermission("doctor_categories"), doctorCategoryRoutes);
  app.use(
    "/api/doctor-subcategories",
    requirePermission("doctor_sub_categories"),
    doctorSubcategoryRoutes
  );
  app.use("/api/hospitals", requirePermission("hospitals"), hospitalsRoutes(io));
  app.use("/api/pharmacies", requirePermission("pharmacies"), pharmaciesRoutes);
  app.use("/api/profiles", requirePermission("profiles"), profilesRoutes);

  app.use("/api/drugs", requirePermission("drugs"), drugsRoutes);
  app.use("/api/product-types", requirePermission("product_types"), productTypeRoutes);
  app.use("/api/manufacturers", requirePermission("manufacturers"), manufacturerRoutes);
  app.use(
    "/api/producing-countries",
    requirePermission("manufacturer_countries"),
    producingCountryRoutes
  );

  app.use("/api/sales-entries", requirePermission("sales"), salesEntriesRoutes);
  app.use("/api/doctor-entry-items", doctorEntryItemsRoutes);
  app.use("/api/budgets", requirePermission("budgets"), budgetRoutes);
  app.use("/api/budget-requireds", budgetRequirdRoutes);
  app.use("/api/budget-requests", budgetRequestRoutes);

    app.use("/api/attendance", attendanceRoutes(io));

  app.use("/api/plannings", requirePermission("plannings"), planningsRoutes(io));
  app.use("/api/tasks", tasksRoutes);

  app.use("/api/reports/efficiency", requirePermission("efficiency_report"), efficiencyRoutes);
  app.use(
    "/api/reports/reimbursement",
    requirePermission("reimbursement_report"),
    reimbursementRoutes
  );
  app.use("/api/reports/attendances", requirePermission("attendances"), attendancesReportRoutes);
  app.use(
    "/api/reports/staff-performance",
    requirePermission("staff_performance_report"),
    staffPerformanceRoutes
  );
  app.use("/api/prescriptions", requirePermission("prescriptions"), prescriptionsRoutes);
  app.use("/api/employee-targets", requirePermission("employee_targets"), employeeTargetsRoutes);
  app.use("/api/employee-sales", requirePermission("employee_sales"), employeeSalesRoutes);
  app.use("/api/doctor-sales", requirePermission("doctor_sales"), doctorSalesRoutes);
  app.use("/api/doctor-targets", requirePermission("doctor_targets"), doctorTargetsRoutes);
  app.use("/api/employee-accounts", requirePermission("employee_accounts"), employeeAccountsRoutes);
  app.use("/api/analytics", requirePermission("analytics"), analyticsRoutes);
  app.use("/api/budgets-list", requirePermission("budgets"), budgetsListRoutes);

  app.use("/api/leaves", requirePermission("leaves"), leaveRoutes);

  app.use("/api/notifications", notificationsRoutes(io));

  app.use("/api/config/plan", planConfigRoutes);
  app.use("/api/config/notifications", notificationConfigRoutes);
  app.use("/api/config/batch", batchConfigRoutes);

  return app;
}
