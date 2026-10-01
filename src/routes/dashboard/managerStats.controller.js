import Employee from "../../models/Employee.js";
import PlanConfiguration from "../../models/PlanConfiguration.js";
import PlanConfigurationDoctor from "../../models/PlanConfigurationDoctor.js";
import Attendance from "../../models/Attendance.js";
import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";

export async function getManagerStats(req, res) {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const scopeIds = await getScopeEmployeeIds(req.employee);

    const empFilter = { isActive: true };
    if (scopeIds) empFilter._id = { $in: scopeIds };
    const teamSize = await Employee.countDocuments(empFilter);

    const planTodayFilter = { period: { $gte: startOfDay }, status: { $in: ["i_went", "i_left", "completed"] } };
    if (scopeIds) planTodayFilter.performer = { $in: scopeIds };
    const activePlanIds = await PlanConfiguration.find(planTodayFilter).distinct("performer");
    const attTodayFilter = { attendanceTime: { $gte: startOfDay }, viaPlan: null };
    if (scopeIds) attTodayFilter.employee = { $in: scopeIds };
    const activeAttIds = await Attendance.find(attTodayFilter).distinct("employee");
    const activeToday = new Set([...activePlanIds.map(String), ...activeAttIds.map(String)]).size;

    const planMonthFilter = { period: { $gte: monthStart, $lte: monthEnd }, status: "completed" };
    if (scopeIds) planMonthFilter.performer = { $in: scopeIds };
    const monthPlanIds = await PlanConfiguration.find(planMonthFilter).distinct("_id");
    const visitsThisMonth = monthPlanIds.length;
    const doctorsVisited = await PlanConfigurationDoctor.countDocuments({ planConfiguration: { $in: monthPlanIds } });

    const entryFilter = { period: monthStart };
    if (scopeIds) entryFilter.employee = { $in: scopeIds };
    const items = await DoctorEntryItem.find(entryFilter).populate("drug", "price");
    let salesAmount = 0, targetAmount = 0, prescriptionAmount = 0;
    items.forEach((it) => {
      const price = it.drug?.price || 0;
      salesAmount += (it.sale || 0) * price;
      targetAmount += (it.quota || 0) * price;
      prescriptionAmount += (it.prescription || 0) * price;
    });
    const achievementPct = targetAmount > 0 ? Math.round((salesAmount / targetAmount) * 1000) / 10 : 0;

    res.json({
      scope: scopeIds ? "team" : "all",
      teamSize, activeToday, visitsThisMonth, doctorsVisited,
      salesAmount: Math.round(salesAmount * 100) / 100,
      targetAmount: Math.round(targetAmount * 100) / 100,
      prescriptionAmount: Math.round(prescriptionAmount * 100) / 100,
      achievementPct,
    });
  } catch (err) {
    console.error("getManagerStats failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
