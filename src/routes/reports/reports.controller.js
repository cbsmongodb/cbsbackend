import PlanConfiguration from "../../models/PlanConfiguration.js";
import PlanConfigurationDoctor from "../../models/PlanConfigurationDoctor.js";
import Attendance from "../../models/Attendance.js";
import Address from "../../models/Address.js";
import Employee from "../../models/Employee.js";
import Budget from "../../models/Budget.js";
import Group from "../../models/Group.js";
import Section from "../../models/Section.js";
import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import { sendAsExcel } from "../../utils/excel.js";
import { getReimbursementOrderIndex } from "../../utils/reimbursementOrder.js";

export async function getEfficiencyReport(req, res) {
  try {
    const { from, to, employee, hospital } = req.query;

    const planFilter = {};
    if (from || to) {
      planFilter.period = {};
      if (from) planFilter.period.$gte = new Date(from);
      if (to) planFilter.period.$lte = new Date(to);
    }
    if (employee) planFilter.performer = employee;
    if (hospital) planFilter.hospital = hospital;

    const plans = await PlanConfiguration.find(planFilter)
      .populate("performer", "firstName lastName")
      .populate("hospital", "name")
      .populate("pharmacy", "pharmacyName");

    const planIds = plans.map((p) => p._id);
    const planById = new Map(plans.map((p) => [String(p._id), p]));

    const pcds = await PlanConfigurationDoctor.find({
      planConfiguration: { $in: planIds },
    }).populate({ path: "doctor", populate: "profile" });

    const groups = new Map();
    pcds.forEach((pcd) => {
      const plan = planById.get(String(pcd.planConfiguration));
      if (!plan || !pcd.doctor) return;

      const dateKey = new Date(plan.period).toISOString().slice(0, 10);
      const employeeId = String(plan.performer?._id || "");
      const placeId = String(plan.hospital?._id || plan.pharmacy?._id || "");
      const groupKey = `${dateKey}_${employeeId}_${placeId}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          date: plan.period,
          employeeName:
            plan.performer?.name ||
            `${plan.performer?.firstName || ""} ${plan.performer?.lastName || ""}`.trim(),
          placeName: plan.hospital?.name || plan.pharmacy?.pharmacyName || "უცნობი",
          doctors: [],
        });
      }

      groups.get(groupKey).doctors.push({
        name:
          pcd.doctor.name ||
          `${pcd.doctor.firstName || ""} ${pcd.doctor.lastName || ""}`.trim(),
        profile: pcd.doctor.profile?.name || null,
      });
    });

    const result = [...groups.values()]
      .map((g) => ({ ...g, visitCount: g.doctors.length }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json(result);
  } catch (err) {
    console.error("getEfficiencyReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getReimbursementReport(req, res) {
  try {
    const { from, to, employee } = req.query;

    const filter = { status: { $in: ["i_went", "i_left", "completed"] } };
    if (from || to) {
      filter.period = {};
      if (from) filter.period.$gte = new Date(from);
      if (to) filter.period.$lte = new Date(to);
    }
    if (employee) filter.performer = employee;

    const plans = await PlanConfiguration.find(filter)
      .populate("performer", "firstName lastName")
      .populate({ path: "hospital", populate: "region" })
      .sort({ iWentAt: 1 });

    const seen = new Map();
    plans.forEach((plan) => {
      if (!plan.hospital?.region) return;
      const dateKey = new Date(plan.period).toISOString().slice(0, 10);
      const empId = String(plan.performer?._id || "");
      const key = `${dateKey}_${empId}`;
      if (seen.has(key)) return;

      seen.set(key, {
        date: plan.period,
        employeeName:
          plan.performer?.name ||
          `${plan.performer?.firstName || ""} ${plan.performer?.lastName || ""}`.trim(),
        regionName: plan.hospital.region.name,
        amount: plan.hospital.region.reimbursementAmt || 0,
      });
    });

    const result = [...seen.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(result);
  } catch (err) {
    console.error("getReimbursementReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function exportReimbursementReport(req, res) {
  try {
    const { from, to, employee } = req.query;

    const filter = { status: { $in: ["i_went", "i_left", "completed"] } };
    if (from || to) {
      filter.period = {};
      if (from) filter.period.$gte = new Date(from);
      if (to) filter.period.$lte = new Date(to);
    }
    if (employee) filter.performer = employee;

    const plans = await PlanConfiguration.find(filter)
      .populate("performer", "firstName lastName")
      .populate({ path: "hospital", populate: "region" })
      .sort({ iWentAt: 1 });

    const seen = new Map();
    plans.forEach((plan) => {
      if (!plan.hospital?.region) return;
      const dateKey = new Date(plan.period).toISOString().slice(0, 10);
      const empId = String(plan.performer?._id || "");
      const key = `${dateKey}_${empId}`;
      if (seen.has(key)) return;

      const employeeName =
        plan.performer?.name ||
        `${plan.performer?.firstName || ""} ${plan.performer?.lastName || ""}`.trim();

      seen.set(key, {
        date: plan.period,
        employeeName,
        regionName: plan.hospital.region.name,
        amount: plan.hospital.region.reimbursementAmt || 0,
      });
    });

    const rows = [...seen.values()].sort((a, b) => {
      const orderA = getReimbursementOrderIndex(a.employeeName);
      const orderB = getReimbursementOrderIndex(b.employeeName);
      if (orderA !== orderB) return orderA - orderB;
      if (a.employeeName !== b.employeeName) return a.employeeName.localeCompare(b.employeeName);
      return new Date(a.date) - new Date(b.date);
    });

    const total = rows.reduce((sum, r) => sum + r.amount, 0);

    await sendAsExcel(res, {
      filename: `reimbursement_report_${new Date().toISOString().slice(0, 10)}.xlsx`,
      columns: [
        { header: "თანამშრომელი", key: "employeeName", width: 28 },
        { header: "პერიოდი", key: "dateStr", width: 14 },
        { header: "რეგიონი", key: "regionName", width: 16 },
        { header: "ანაზღაურება (₾)", key: "amount", width: 18 },
      ],
      rows: [
        ...rows.map((r) => ({
          employeeName: r.employeeName,
          dateStr: new Date(r.date).toLocaleDateString("en-GB"),
          regionName: r.regionName,
          amount: r.amount,
        })),
        {},
        { employeeName: "სულ", amount: total },
      ],
    });
  } catch (err) {
    console.error("exportReimbursementReport failed:", err);
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

    const records = await Attendance.find(filter)
      .populate("employee", "firstName lastName")
      .sort({ attendanceTime: -1 });

    const standaloneIds = records.filter((r) => !r.viaPlan).map((r) => r._id);
    const planIds = records.filter((r) => r.viaPlan).map((r) => r.viaPlan);

    const [standaloneAddresses, planAddresses] = await Promise.all([
      Address.find({ addressableType: "Attendance", addressableId: { $in: standaloneIds } }),
      Address.find({ addressableType: "PlanConfiguration", addressableId: { $in: planIds } }),
    ]);

    const addressByAttendanceId = new Map(
      standaloneAddresses.map((a) => [String(a.addressableId), a.cleanAddress])
    );

    const planAddressByPlanAndType = new Map();
    planAddresses.forEach((a) => {
      planAddressByPlanAndType.set(`${a.addressableId}_${a.addressType}`, a.cleanAddress);
    });

    const rows = records.map((r) => {
      let address = null;
      if (r.viaPlan) {
        const addrType =
          r.attendanceType === "checkin" ? "performer_i_went_location" : "performer_i_left_location";
        address = planAddressByPlanAndType.get(`${r.viaPlan}_${addrType}`) || null;
      } else {
        address = addressByAttendanceId.get(String(r._id)) || null;
      }

      return {
        _id: r._id,
        employeeName:
          r.employee?.name || `${r.employee?.firstName || ""} ${r.employee?.lastName || ""}`.trim(),
        attendanceTime: r.attendanceTime,
        attendanceType: r.attendanceType,
        attendanceStatus: r.attendanceStatus,
        address,
      };
    });

    res.json(rows);
  } catch (err) {
    console.error("getAttendanceReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/reports/staff-performance
// ?section=&group=&employee=&mode=month|range&month=YYYY-MM&from=&to=&page=&limit=
//
// Two filter modes:
//  - "month": exact calendar month selected -> all 6 metrics returned,
//    since DoctorEntryItem (prescription/target/sales) is only stored at
//    month granularity, matching a full-month range exactly.
//  - "range": arbitrary from/to dates -> only the 3 daily-accurate metrics
//    (visits, doctorsVisited, paidAmount) are returned; the DoctorEntryItem
//    -based columns are omitted entirely rather than shown misleadingly
//    against a whole month that doesn't match the picked range.
export async function getStaffPerformanceReport(req, res) {
  try {
    const { section, group, employee, mode, month, from, to } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100);

    // 1. resolve which employees are in scope
    let employeeFilter = { isActive: true };
    if (employee) {
      employeeFilter = { _id: employee };
    } else if (group) {
      // Group.members[] is basically never populated in real data — the
      // real membership signal lives on Employee.group. Query it directly.
      const memberIds = await Employee.find({ group }).distinct("_id");
      employeeFilter = { _id: { $in: memberIds } };
    } else if (section) {
      const groupIds = await Group.find({ section }).distinct("_id");
      const memberIds = await Employee.find({ group: { $in: groupIds } }).distinct("_id");
      employeeFilter = { _id: { $in: memberIds } };
    }

    const total = await Employee.countDocuments(employeeFilter);
    const employees = await Employee.find(employeeFilter)
      .select("firstName lastName")
      .sort({ firstName: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    // 2. resolve the date range for the daily-accurate metrics, and whether
    //    the month-only metrics should be computed at all
    const isMonthMode = mode === "month" && !!month;
    let rangeStart, rangeEnd, monthStart;

    if (isMonthMode) {
      const [y, m] = month.split("-").map(Number);
      monthStart = new Date(Date.UTC(y, m - 1, 1));
      rangeStart = monthStart;
      rangeEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    } else {
      rangeStart = from ? new Date(from) : new Date(new Date().setDate(1));
      rangeEnd = to ? new Date(to) : new Date();
      rangeEnd.setHours(23, 59, 59, 999);
    }

    // 3. per-employee computation
    const rows = await Promise.all(
      employees.map(async (emp) => {
        const planFilter = {
          performer: emp._id,
          period: { $gte: rangeStart, $lte: rangeEnd },
          status: "completed",
        };
        const planIds = await PlanConfiguration.find(planFilter).distinct("_id");
        const visits = planIds.length;
        const doctorsVisited = await PlanConfigurationDoctor.countDocuments({
          planConfiguration: { $in: planIds },
        });

        const paidAgg = await Budget.aggregate([
          { $match: { employee: emp._id, date: { $gte: rangeStart, $lte: rangeEnd } } },
          { $group: { _id: null, sum: { $sum: "$paidAmount" } } },
        ]);
        const totalPaidAmount = Math.round((paidAgg[0]?.sum || 0) * 100) / 100;

        const row = {
          employeeId: emp._id,
          employeeName: `${emp.firstName} ${emp.lastName}`.trim(),
          visits,
          doctorsVisited,
          totalPaidAmount,
        };

        if (isMonthMode) {
          const items = await DoctorEntryItem.find({ employee: emp._id, period: monthStart }).populate(
            "drug",
            "price"
          );
          let prescriptionAmount = 0;
          let targetAmount = 0;
          let salesAmount = 0;
          items.forEach((it) => {
            const price = it.drug?.price || 0;
            prescriptionAmount += (it.prescription || 0) * price;
            targetAmount += (it.quota || 0) * price;
            salesAmount += (it.sale || 0) * price;
          });
          row.totalPrescriptionAmount = Math.round(prescriptionAmount * 100) / 100;
          row.targetAmount = Math.round(targetAmount * 100) / 100;
          row.salesAmount = Math.round(salesAmount * 100) / 100;
        }

        return row;
      })
    );

    res.json({
      docs: rows,
      total,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      limit,
      mode: isMonthMode ? "month" : "range",
    });
  } catch (err) {
    console.error("getStaffPerformanceReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
