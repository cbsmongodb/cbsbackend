import PlanConfiguration from "../../models/PlanConfiguration.js";
import Attendance from "../../models/Attendance.js";

// "Employee Performance" report — Rails builds this from PlanConfiguration
// (visit counts per performer/doctor), not from a flat sales table. This
// is a placeholder aggregation (visit counts only) — swap in the exact
// Rails calculation once the real formula is confirmed.
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

// placeholder — real reimbursement calculation uses Region.reimbursementAmt
// per performer/period, joined through the hospital/pharmacy on each plan.
// Comes from the Rails app's reimbursement_export scope on PlanConfiguration.
export async function getReimbursementReport(req, res) {
  res.json({ note: "TODO: port reimbursement calculation from Rails", rows: [] });
}

// raw attendance rows for the reporting period
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
