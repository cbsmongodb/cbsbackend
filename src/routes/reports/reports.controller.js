import PlanConfiguration from "../../models/PlanConfiguration.js";
import Attendance from "../../models/Attendance.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";

export async function getEfficiencyReport(req, res) {
  try {
    const filter = {};
    if (req.query.from || req.query.to) {
      filter.period = {};
      if (req.query.from) filter.period.$gte = new Date(req.query.from);
      if (req.query.to) filter.period.$lte = new Date(req.query.to);
    }
    if (req.query.performer) filter.performer = req.query.performer;
    if (req.query.status) filter.status = req.query.status;

    const rows = await PlanConfiguration.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$performer",
          numberOfVisits: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "employees",
          localField: "_id",
          foreignField: "_id",
          as: "employee",
        },
      },
      { $unwind: "$employee" },
      {
        $project: {
          employee: { firstName: 1, lastName: 1 },
          numberOfVisits: 1,
        },
      },
      { $sort: { "employee.firstName": 1 } },
    ]);

    res.json(rows);
  } catch (err) {
    console.error("getEfficiencyReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getReimbursementReport(req, res) {
  try {
    const { from, to, performer } = req.query;

    const filter = { status: { $in: ["i_left", "completed"] } };
    if (from || to) {
      filter.period = {};
      if (from) filter.period.$gte = new Date(from);
      if (to) filter.period.$lte = new Date(to);
    }
    if (performer) filter.performer = performer;

    const plans = await PlanConfiguration.find(filter).select("performer period");

    const daysByPerformer = new Map();
    for (const plan of plans) {
      const performerId = String(plan.performer);
      const dayKey = new Date(plan.period).toISOString().slice(0, 10);
      if (!daysByPerformer.has(performerId)) daysByPerformer.set(performerId, new Set());
      daysByPerformer.get(performerId).add(dayKey);
    }

    const rows = [];
    for (const [performerId, days] of daysByPerformer.entries()) {
      const employee = await Employee.findById(performerId)
        .select("firstName lastName group")
        .populate({ path: "group", populate: "region" });

      const region = employee?.group?.region;
      const ratePerDay = region?.reimbursementAmt || 0;
      const daysWorked = days.size;

      rows.push({
        employee: employee ? { firstName: employee.firstName, lastName: employee.lastName } : null,
        regionName: region?.name || "Unassigned",
        daysWorked,
        ratePerDay,
        totalReimbursement: Math.round(daysWorked * ratePerDay * 100) / 100,
      });
    }

    rows.sort((a, b) => (a.employee?.firstName || "").localeCompare(b.employee?.firstName || ""));

    res.json(rows);
  } catch (err) {
    console.error("getReimbursementReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getAttendanceReport(req, res) {
  try {
    const filter = {};
    if (req.query.from || req.query.to) {
      filter.attendanceTime = {};
      if (req.query.from) filter.attendanceTime.$gte = new Date(req.query.from);
      if (req.query.to) filter.attendanceTime.$lte = new Date(req.query.to);
    }
    if (req.query.employee) filter.employee = req.query.employee;

    const rows = await Attendance.find(filter)
      .populate("employee", "firstName lastName")
      .sort({ attendanceTime: -1 });

    res.json(rows);
  } catch (err) {
    console.error("getAttendanceReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
