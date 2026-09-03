import PlanConfiguration from "../../models/PlanConfiguration.js";
import PlanConfigurationDoctor from "../../models/PlanConfigurationDoctor.js";
import Attendance from "../../models/Attendance.js";
import Address from "../../models/Address.js";

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

    // one row per employee per day — first hospital visit of that day wins
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

    // split by source: standalone (own Address, addressableType "Attendance")
    // vs via-plan (address lives on the PlanConfiguration instead)
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
