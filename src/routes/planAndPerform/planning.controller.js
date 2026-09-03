import PlanConfiguration from "../../models/PlanConfiguration.js";
import PlanConfigurationDoctor from "../../models/PlanConfigurationDoctor.js";
import Doctor from "../../models/Doctor.js";
import Address from "../../models/Address.js";
import Attendance from "../../models/Attendance.js";
import Hospital from "../../models/Hospital.js";
import { distanceInMeters } from "../../utils/geo.js";
import { computeAttendanceStatus } from "../../utils/attendanceStatus.js";

const POPULATE = "employee hospital pharmacy author performer";

export async function getAllPlannings(req, res) {
  try {
    const filter = {};
    if (req.query.performer) filter.performer = req.query.performer;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.period_from || req.query.period_to) {
      filter.period = {};
      if (req.query.period_from) filter.period.$gte = new Date(req.query.period_from);
      if (req.query.period_to) filter.period.$lte = new Date(req.query.period_to);
    }

    const plans = await PlanConfiguration.find(filter).populate(POPULATE).sort({ period: -1 });

    const planIds = plans.map((p) => p._id);
    const pcds = await PlanConfigurationDoctor.find({ planConfiguration: { $in: planIds } }).populate(
      "doctor"
    );
    const doctorsByPlan = new Map();
    pcds.forEach((pcd) => {
      const key = String(pcd.planConfiguration);
      if (!doctorsByPlan.has(key)) doctorsByPlan.set(key, []);
      if (pcd.doctor) doctorsByPlan.get(key).push(pcd.doctor);
    });

    const withDoctors = plans.map((plan) => ({
      ...plan.toObject(),
      doctors: doctorsByPlan.get(String(plan._id)) || [],
    }));

    res.json(withDoctors);
  } catch (err) {
    console.error("getAllPlannings failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getPlanning(req, res) {
  try {
    const plan = await PlanConfiguration.findById(req.params.id)
      .populate(POPULATE)
      .populate({ path: "doctors", populate: "doctor" });
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const doctors = await PlanConfigurationDoctor.find({ planConfiguration: plan._id }).populate(
      "doctor"
    );

    res.json({ ...plan.toObject(), planConfigurationDoctors: doctors });
  } catch (err) {
    console.error("getPlanning failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function createPlanning(req, res) {
  try {
    const plan = await PlanConfiguration.create({
      ...req.body,
      author: req.body.author || req.employee._id,
      performer: req.body.performer || req.employee._id,
      status: req.body.status || "planned",
    });
    const populated = await plan.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("createPlanning failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updatePlanning(req, res) {
  try {
    const plan = await PlanConfiguration.findById(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const today = new Date();
    const planDay = new Date(plan.period);
    const isToday = planDay.toDateString() === today.toDateString();
    if (!isToday) {
      return res.status(400).json({ error: "Only plans scheduled for today can be edited" });
    }

    Object.assign(plan, req.body);
    await plan.save();
    const populated = await plan.populate(POPULATE);
    res.json(populated);
  } catch (err) {
    console.error("updatePlanning failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deletePlanning(req, res) {
  try {
    const plan = await PlanConfiguration.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    await PlanConfigurationDoctor.deleteMany({ planConfiguration: plan._id });
    res.json({ success: true });
  } catch (err) {
    console.error("deletePlanning failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function addDoctor(req, res) {
  try {
    const { doctorId, note } = req.body;
    const existing = await PlanConfigurationDoctor.findOne({
      planConfiguration: req.params.id,
      doctor: doctorId,
    });
    if (existing) return res.json(existing);

    const pcd = await PlanConfigurationDoctor.create({
      planConfiguration: req.params.id,
      doctor: doctorId,
      note,
      status: "planned",
    });
    res.status(201).json(pcd);
  } catch (err) {
    console.error("addDoctor failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function removeDoctor(req, res) {
  try {
    const pcd = await PlanConfigurationDoctor.findOneAndDelete({
      _id: req.params.pcdId,
      planConfiguration: req.params.id,
    });
    if (!pcd) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("removeDoctor failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export function checkIn(io) {
  return async (req, res) => {
    try {
      const plan = await PlanConfiguration.findById(req.params.id).populate("hospital pharmacy");
      if (!plan) return res.status(404).json({ error: "Plan not found" });

      const today = new Date();
      if (new Date(plan.period).toDateString() !== today.toDateString()) {
        return res.status(400).json({ error: "Only today's plans can be checked in" });
      }

      plan.status = "i_went";
      plan.iWentAt = new Date();
      await plan.save();

      const { lat, lng, address } = req.body;
      await Address.create({
        addressableType: "PlanConfiguration",
        addressableId: plan._id,
        addressType: "performer_i_went_location",
        lat,
        lng,
        cleanAddress: address,
      });

      const attendance = await Attendance.create({
        employee: plan.performer,
        attendanceType: "checkin",
        attendanceTime: new Date(),
        attendanceStatus: await computeAttendanceStatus("checkin", new Date()),
        viaPlan: plan._id,
      });

      const distanceFromHospital = plan.hospital
        ? distanceInMeters(lat, lng, plan.hospital.lat, plan.hospital.lng)
        : null;

      const hospitalName = plan.hospital?.name || plan.pharmacy?.pharmacyName;
      io.emit("attendance:new", {
        id: plan.performer,
        checkinTime: attendance.attendanceTime,
        hospitalName,
        address,
        attendanceType: "checkin",
        distanceFromHospital,
      });

      res.json({ plan, attendance, distanceFromHospital });
    } catch (err) {
      console.error("checkIn failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export function checkOut(io) {
  return async (req, res) => {
    try {
      const plan = await PlanConfiguration.findById(req.params.id).populate("hospital pharmacy");
      if (!plan) return res.status(404).json({ error: "Plan not found" });

      const today = new Date();
      if (new Date(plan.period).toDateString() !== today.toDateString()) {
        return res.status(400).json({ error: "Only today's plans can be checked out" });
      }

      plan.status = "i_left";
      plan.iLeftAt = new Date();
      await plan.save();

      const { lat, lng, address } = req.body;
      await Address.create({
        addressableType: "PlanConfiguration",
        addressableId: plan._id,
        addressType: "performer_i_left_location",
        lat,
        lng,
        cleanAddress: address,
      });

      const attendance = await Attendance.create({
        employee: plan.performer,
        attendanceType: "checkout",
        attendanceTime: new Date(),
        attendanceStatus: await computeAttendanceStatus("checkout", new Date()),
        viaPlan: plan._id,
      });

      const distanceFromHospital = plan.hospital
        ? distanceInMeters(lat, lng, plan.hospital.lat, plan.hospital.lng)
        : null;

      const hospitalName = plan.hospital?.name || plan.pharmacy?.pharmacyName;
      io.emit("attendance:new", {
        id: plan.performer,
        checkinTime: attendance.attendanceTime,
        hospitalName,
        address,
        attendanceType: "checkout",
        distanceFromHospital,
      });

      res.json({ plan, attendance, distanceFromHospital });
    } catch (err) {
      console.error("checkOut failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export async function getVisitDurations(req, res) {
  try {
    const { performer, date } = req.query;
    if (!performer) return res.status(400).json({ error: "performer is required" });

    const day = date ? new Date(date) : new Date();
    const startOfDay = new Date(day);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 59, 999);

    const plans = await PlanConfiguration.find({
      performer,
      iWentAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .populate("hospital", "name")
      .populate("pharmacy", "pharmacyName")
      .sort({ iWentAt: 1 });

    const visits = plans.map((plan) => {
      const locationName = plan.hospital?.name || plan.pharmacy?.pharmacyName || "Unknown";
      const durationMinutes =
        plan.iWentAt && plan.iLeftAt
          ? Math.round((new Date(plan.iLeftAt) - new Date(plan.iWentAt)) / 60000)
          : null;

      return {
        planId: plan._id,
        locationName,
        checkinTime: plan.iWentAt,
        checkoutTime: plan.iLeftAt,
        durationMinutes,
      };
    });

    const gaps = [];
    for (let i = 1; i < visits.length; i++) {
      const prev = visits[i - 1];
      const curr = visits[i];
      if (!prev.checkoutTime || !curr.checkinTime) continue;

      gaps.push({
        fromLocation: prev.locationName,
        toLocation: curr.locationName,
        gapMinutes: Math.round((new Date(curr.checkinTime) - new Date(prev.checkoutTime)) / 60000),
      });
    }

    res.json({ visits, gaps });
  } catch (err) {
    console.error("getVisitDurations failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function doctorsForPlanHospital(req, res) {
  try {
    const plan = await PlanConfiguration.findById(req.params.id);
    if (!plan?.hospital) return res.json([]);

    const hospital = await Hospital.findById(plan.hospital);
    if (!hospital) return res.json([]);

    const Doctor = (await import("../../models/Doctor.js")).default;
    const doctors = await Doctor.find({ "hospitals.hospital": plan.hospital, isActive: true });

    res.json(doctors);
  } catch (err) {
    console.error("doctorsForPlanHospital failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

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
