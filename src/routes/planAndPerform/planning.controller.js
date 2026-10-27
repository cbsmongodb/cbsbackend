import PlanConfiguration from "../../models/PlanConfiguration.js";
import PlanConfigurationDoctor from "../../models/PlanConfigurationDoctor.js";
import Doctor from "../../models/Doctor.js";
import Address from "../../models/Address.js";
import Attendance from "../../models/Attendance.js";
import Hospital from "../../models/Hospital.js";
import { distanceInMeters } from "../../utils/geo.js";
import { computeAttendanceStatus } from "../../utils/attendanceStatus.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";

// these roles SEE their division's plannings (list, Field Team Status), but can
// create, edit and delete only plans where they themselves are the performer
const OWN_PLANNINGS_ROLES = new Set(["product manager"]);
const ownPlanningsOnly = (emp) => OWN_PLANNINGS_ROLES.has((emp?.role?.name || "").toLowerCase().trim());
const isOwnPlan = (plan, emp) => String(plan.performer) === String(emp._id);

const POPULATE = "employee hospital pharmacy author performer";

// list view only needs a few fields — full Employee docs (incl. password hash) were being sent
const EMP_FIELDS = "firstName lastName employeeType isActive";
const LIST_POPULATE = [
  { path: "employee", select: EMP_FIELDS },
  { path: "author", select: EMP_FIELDS },
  { path: "performer", select: EMP_FIELDS },
  { path: "hospital", select: "name lat lng" },
  { path: "pharmacy", select: "pharmacyName lat lng" },
];

export async function getAllPlannings(req, res) {
  try {
    const filter = {};
    if (req.query.performer) filter.performer = req.query.performer;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.planType) filter.planType = req.query.planType;
    if (req.query.period_from || req.query.period_to) {
      filter.period = {};
      if (req.query.period_from) filter.period.$gte = new Date(req.query.period_from);
      if (req.query.period_to) filter.period.$lte = new Date(req.query.period_to);
    }

    const scopeIds = await getScopeEmployeeIds(req.employee);
    if (scopeIds) {
      const scopeSet = new Set(scopeIds.map(String));
      if (filter.performer) {
        if (!scopeSet.has(String(filter.performer))) filter.performer = { $in: [] };
      } else {
        filter.performer = { $in: scopeIds };
      }
    }

    // free-text search: hospital / pharmacy name or performer's name
    const search = String(req.query.search || "").trim();
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const { default: Pharmacy } = await import("../../models/Pharmacy.js");
      const { default: Employee } = await import("../../models/Employee.js");
      const [hospitalIds, pharmacyIds, employeeIds] = await Promise.all([
        Hospital.find({ name: rx }).distinct("_id"),
        Pharmacy.find({ pharmacyName: rx }).distinct("_id"),
        Employee.find({ $or: [{ firstName: rx }, { lastName: rx }] }).distinct("_id"),
      ]);
      filter.$or = [
        { hospital: { $in: hospitalIds } },
        { pharmacy: { $in: pharmacyIds } },
        { performer: { $in: employeeIds } },
      ];
    }

    // ?page= -> paginated { docs, total, page, pages, limit } (the Plannings page);
    // without it -> plain array as before (Today's visits, Field Team Status...)
    const paginated = req.query.page !== undefined;
    let plans, total, pageNum, limitNum;
    if (paginated) {
      pageNum = Math.max(parseInt(req.query.page) || 1, 1);
      limitNum = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 250);
      [plans, total] = await Promise.all([
        PlanConfiguration.find(filter)
          .populate(LIST_POPULATE)
          .sort({ period: -1, _id: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .lean(),
        PlanConfiguration.countDocuments(filter),
      ]);
    } else {
      const limit = Math.min(Number(req.query.limit) || 0, 5000);
      let query = PlanConfiguration.find(filter).populate(LIST_POPULATE).sort({ period: -1 }).lean();
      if (limit > 0) query = query.limit(limit);
      plans = await query;
    }

    const planIds = plans.map((p) => p._id);
    const pcds = await PlanConfigurationDoctor.find({ planConfiguration: { $in: planIds } })
      .select("planConfiguration doctor")
      .populate({ path: "doctor", select: "firstName lastName" })
      .lean();
    const doctorsByPlan = new Map();
    pcds.forEach((pcd) => {
      const key = String(pcd.planConfiguration);
      if (!doctorsByPlan.has(key)) doctorsByPlan.set(key, []);
      if (pcd.doctor) doctorsByPlan.get(key).push(pcd.doctor);
    });

    const withDoctors = plans.map((plan) => ({
      ...plan,
      doctors: doctorsByPlan.get(String(plan._id)) || [],
    }));

    if (paginated) {
      return res.json({
        docs: withDoctors,
        total,
        page: pageNum,
        pages: Math.max(Math.ceil(total / limitNum), 1),
        limit: limitNum,
      });
    }
    res.json(withDoctors);
  } catch (err) {
    console.error("getAllPlannings failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getPlanning(req, res) {
  try {
        const plan = await PlanConfiguration.findById(req.params.id)
      .populate(POPULATE).lean();

    if (!plan) return res.status(404).json({ error: "Plan not found" });

    const doctors = await PlanConfigurationDoctor.find({ planConfiguration: plan._id }).populate(
      "doctor"
    ).lean();

    res.json({ ...plan, planConfigurationDoctors: doctors });
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
      performer: ownPlanningsOnly(req.employee) ? req.employee._id : req.body.performer || req.employee._id,
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

// When a manager moves a visit's status BACK (e.g. "completed" -> "i_went"
// after an accidental check-out), remove what that step had recorded:
// the check-out time, its attendance row and its location. Moving back to
// "planned" also removes the check-in. The visit then shows the check-out
// (or check-in) button again for the employee.
async function undoVisitMarks(plan, newStatus) {
  const wasLeft = ["completed", "i_left"].includes(plan.status);
  const wasIn = wasLeft || plan.status === "i_went";
  const undoLeft = wasLeft && ["i_went", "planned"].includes(newStatus);
  const undoIn = wasIn && newStatus === "planned";
  if (undoLeft) {
    plan.iLeftAt = undefined;
    await Promise.all([
      Attendance.deleteMany({ viaPlan: plan._id, attendanceType: "checkout" }),
      Address.deleteMany({ addressableType: "PlanConfiguration", addressableId: plan._id, addressType: "performer_i_left_location" }),
    ]);
  }
  if (undoIn) {
    plan.iWentAt = undefined;
    await Promise.all([
      Attendance.deleteMany({ viaPlan: plan._id, attendanceType: "checkin" }),
      Address.deleteMany({ addressableType: "PlanConfiguration", addressableId: plan._id, addressType: "performer_i_went_location" }),
    ]);
  }
}

export async function updatePlanning(req, res) {
  try {
    const plan = await PlanConfiguration.findById(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    if (ownPlanningsOnly(req.employee) && !isOwnPlan(plan, req.employee)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (ownPlanningsOnly(req.employee)) delete req.body.performer;

    const today = new Date();
    const planDay = new Date(plan.period);
    const isToday = planDay.toDateString() === today.toDateString();
    if (!isToday) {
      return res.status(400).json({ error: "Only plans scheduled for today can be edited" });
    }

    if (req.body.status && req.body.status !== plan.status) {
      await undoVisitMarks(plan, req.body.status);
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
    if (ownPlanningsOnly(req.employee)) {
      const own = await PlanConfiguration.findById(req.params.id).select("performer");
      if (own && !isOwnPlan(own, req.employee)) return res.status(403).json({ error: "Forbidden" });
    }
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

      plan.status = "completed";
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
      .sort({ iWentAt: 1 }).lean();

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
    const plan = await PlanConfiguration.findById(req.params.id).lean();
    if (!plan?.hospital) return res.json([]);

    const hospital = await Hospital.findById(plan.hospital).lean();
    if (!hospital) return res.json([]);

    const Doctor = (await import("../../models/Doctor.js")).default;
    const doctors = await Doctor.find({ "hospitals.hospital": plan.hospital, isActive: true }).lean();

    res.json(doctors);
  } catch (err) {
    console.error("doctorsForPlanHospital failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
