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
import {
  roleRoutes,
  designationRoutes,
  sectionRoutes,
  groupRoutes,
  regionRoutes,
} from "./routes/admin/admin.routes.js";
import divisionsRoutes from "./routes/divisions/divisions.routes.js";

// io is passed in from server.js so attendance.routes.js can emit
// live-feed events straight from the controller
export function createApp(io) {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
  app.use(express.json());

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  // --- auth (public — no permission gate) ---
  app.use("/api/auth", authRoutes);

  // --- administration ---
  app.use("/api/employees", requirePermission("employees"), employeesRoutes);
  app.use("/api/admin/roles", requirePermission("roles"), roleRoutes);
  app.use("/api/admin/designations", requirePermission("designations"), designationRoutes);
  app.use("/api/admin/sections", requirePermission("sections"), sectionRoutes);
  app.use("/api/admin/groups", requirePermission("groups"), groupRoutes);
  app.use("/api/admin/regions", requirePermission("regions"), regionRoutes);
  // no Rails equivalent for divisions — auth only, no permission key to check
  app.use("/api/divisions", divisionsRoutes);

  // --- configure market ---
  app.use("/api/doctors", requirePermission("doctors"), doctorsRoutes);
  app.use("/api/doctor-categories", requirePermission("doctor_categories"), doctorCategoryRoutes);
  app.use(
    "/api/doctor-subcategories",
    requirePermission("doctor_sub_categories"),
    doctorSubcategoryRoutes
  );
  app.use("/api/hospitals", requirePermission("hospitals"), hospitalsRoutes);
  app.use("/api/pharmacies", requirePermission("pharmacies"), pharmaciesRoutes);
  app.use("/api/profiles", requirePermission("profiles"), profilesRoutes);

  // --- configure product ---
  app.use("/api/drugs", requirePermission("drugs"), drugsRoutes);
  app.use("/api/product-types", requirePermission("product_types"), productTypeRoutes);
  app.use("/api/manufacturers", requirePermission("manufacturers"), manufacturerRoutes);
  app.use(
    "/api/producing-countries",
    requirePermission("manufacturer_countries"),
    producingCountryRoutes
  );

  // --- data entry / sales ---
  app.use("/api/sales-entries", requirePermission("sales"), salesEntriesRoutes);
  // Doctor Sales Entry is gated by role helper methods in Rails
  // (system_admin?/office_manager_with_role?/etc), not a privilege key —
  // auth only here; tighten with role-name checks later if needed.
  app.use("/api/doctor-entry-items", doctorEntryItemsRoutes);
  app.use("/api/budgets", requirePermission("budgets"), budgetRoutes);
  // no dedicated Rails privilege key for the approval workflow sub-resources
  // — auth only (each router already requires a valid login internally)
  app.use("/api/budget-requireds", budgetRequirdRoutes);
  app.use("/api/budget-requests", budgetRequestRoutes);

  // --- attendance / live feed (needs io) ---
  app.use("/api/attendance", requirePermission("attendances"), attendanceRoutes(io));

  // --- plan and perform (needs io — checkin/checkout broadcast to Live Feed) ---
  app.use("/api/plannings", requirePermission("plannings"), planningsRoutes(io));
  // Task has no dedicated privilege key in Rails — auth only
  app.use("/api/tasks", tasksRoutes);

  // --- reports ---
  app.use("/api/reports/efficiency", requirePermission("efficiency_report"), efficiencyRoutes);
  app.use(
    "/api/reports/reimbursement",
    requirePermission("reimbursement_report"),
    reimbursementRoutes
  );
  app.use("/api/reports/attendances", requirePermission("attendances"), attendancesReportRoutes);

  return app;
}
