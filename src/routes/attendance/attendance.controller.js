import Attendance from "../../models/Attendance.js";
import Address from "../../models/Address.js";
import Employee from "../../models/Employee.js";
import PlanConfiguration from "../../models/PlanConfiguration.js";
import { computeAttendanceStatus } from "../../utils/attendanceStatus.js";
import { distanceInMeters } from "../../utils/geo.js";

export async function setCurrentLocation(req, res) {
  try {
    const { lat, lng, address } = req.body;
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: "lat and lng are required" });
    }

    const existing = await Address.findOne({
      addressableType: "Employee",
      addressableId: req.employee._id,
      addressType: "current_location",
    });

    const payload = {
      addressableType: "Employee",
      addressableId: req.employee._id,
      addressType: "current_location",
      lat,
      lng,
      cleanAddress: address || existing?.cleanAddress || "",
    };

    const location = existing
      ? await Address.findByIdAndUpdate(existing._id, payload, { new: true })
      : await Address.create(payload);

    res.json(location);
  } catch (err) {
    console.error("setCurrentLocation failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getCurrentLocations(req, res) {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const locations = await Address.find({
      addressableType: "Employee",
      addressType: "current_location",
      updatedAt: { $gte: startOfDay },
    });

    const employeeIds = locations.map((l) => l.addressableId);
    const employees = await Employee.find({ _id: { $in: employeeIds } })
      .select("firstName lastName group")
      .populate("group", "name");
    const employeeMap = new Map(employees.map((e) => [String(e._id), e]));

    const results = locations
      .filter((l) => l.lat != null && l.lng != null)
      .map((l) => {
        const emp = employeeMap.get(String(l.addressableId));
        return {
          addressId: l._id,
          lat: l.lat,
          lng: l.lng,
          address: l.cleanAddress,
          checkinTime: l.updatedAt,
          employeeId: l.addressableId,
          name: emp?.name || "Unknown",
          groupName: emp?.group?.name || "[Group Not Assigned]",
        };
      });

    res.json(results);
  } catch (err) {
    console.error("getCurrentLocations failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export function markAttendance(io) {
  return async (req, res) => {
    try {
      const { type } = req.body;
      if (!["checkin", "checkout"].includes(type)) {
        return res.status(400).json({ error: "type must be checkin or checkout" });
      }

      const now = new Date();
      const attendanceStatus = await computeAttendanceStatus(type, now);

      // Always create a new record — an employee can check in/out at several
      // different hospitals throughout the day, so we must never overwrite
      // a previous visit's record.
      const attendance = await Attendance.create({
        employee: req.employee._id,
        attendanceType: type,
        attendanceTime: now,
        attendanceStatus,
      });

      const lastLocation = await Address.findOne({
        addressableType: "Employee",
        addressableId: req.employee._id,
        addressType: "current_location",
      });

      const attendanceAddress = await Address.create({
        addressableType: "Attendance",
        addressableId: attendance._id,
        addressType: "attendance",
        lat: lastLocation?.lat,
        lng: lastLocation?.lng,
        cleanAddress: lastLocation?.cleanAddress,
      });

      const feedPayload = {
        id: req.employee._id,
        employeeName: req.employee.name,
        checkinTime: attendance.attendanceTime,
        address: attendanceAddress.cleanAddress,
        attendanceType: attendance.attendanceType,
        attendanceStatus: attendance.attendanceStatus,
      };

      io.emit("attendance:new", feedPayload);

      res.status(201).json({ attendance, location: attendanceAddress });
    } catch (err) {
      console.error("markAttendance failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

export async function getLiveFeed(req, res) {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const dayKey = startOfDay.toISOString().slice(0, 10);

    const plans = await PlanConfiguration.find({
      period: { $gte: startOfDay },
      status: { $in: ["i_went", "i_left", "completed"] },
    })
      .populate("performer", "firstName lastName")
      .populate("hospital", "name lat lng address");

    const planIds = plans.map((p) => p._id);
    const planAddresses = await Address.find({
      addressableType: "PlanConfiguration",
      addressableId: { $in: planIds },
    }).sort({ createdAt: 1 });

    const addressesByPlan = new Map();
    planAddresses.forEach((a) => {
      const key = String(a.addressableId);
      if (!addressesByPlan.has(key)) addressesByPlan.set(key, []);
      addressesByPlan.get(key).push(a);
    });

    const planFeed = plans.map((plan) => {
      const addrs = addressesByPlan.get(String(plan._id)) || [];
      return {
        source: "plan",
        groupKey: String(plan._id),
        employeeId: plan.performer?._id,
        employeeName: plan.performer?.name,
        hospitalName: plan.hospital?.name,
        status: plan.status,
        addresses: addrs.map((a) => ({
          addressType: a.addressType,
          lat: a.lat,
          lng: a.lng,
          cleanAddress: a.cleanAddress,
          time: a.createdAt,
          distanceFromHospital:
            plan.hospital?.lat != null && plan.hospital?.lng != null
              ? distanceInMeters(a.lat, a.lng, plan.hospital.lat, plan.hospital.lng)
              : null,
        })),
      };
    });

    const standaloneAttendances = await Attendance.find({
      attendanceTime: { $gte: startOfDay },
      viaPlan: null,
    })
      .populate("employee", "firstName lastName")
      .sort({ attendanceTime: 1 });

    const attendanceIds = standaloneAttendances.map((a) => a._id);
    const attendanceAddresses = await Address.find({
      addressableType: "Attendance",
      addressableId: { $in: attendanceIds },
    });
    const addressByAttendance = new Map(
      attendanceAddresses.map((a) => [String(a.addressableId), a])
    );

    const attendanceFeed = standaloneAttendances
      .map((att) => {
        const addr = addressByAttendance.get(String(att._id));
        if (!addr || addr.lat == null || addr.lng == null) return null;
        return {
          source: "daily",
          groupKey: `daily-${String(att._id)}`,
          employeeId: att.employee?._id,
          employeeName: att.employee?.name,
          hospitalName: null,
          status: att.attendanceType,
          addresses: [
            {
              addressType: att.attendanceType === "checkin" ? "performer_i_went_location" : "performer_i_left_location",
              lat: addr.lat,
              lng: addr.lng,
              cleanAddress: addr.cleanAddress,
              time: att.attendanceTime,
              distanceFromHospital: null,
            },
          ],
        };
      })
      .filter(Boolean);

    res.json([...planFeed, ...attendanceFeed]);
  } catch (err) {
    console.error("getLiveFeed failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getDailyStatus(req, res) {
  try {
    const day = req.query.date ? new Date(req.query.date) : new Date();
    const startOfDay = new Date(day);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 59, 999);

    const employees = await Employee.find({ isActive: true }).select("firstName lastName");

    const records = await Attendance.find({
      attendanceTime: { $gte: startOfDay, $lte: endOfDay },
    });

    const byEmployee = {};
    for (const r of records) {
      const key = String(r.employee);
      if (!byEmployee[key]) byEmployee[key] = [];
      byEmployee[key].push(r);
    }

    const status = employees.map((emp) => {
      const events = byEmployee[String(emp._id)] || [];
      return {
        employee: emp,
        checkedIn: events.some((e) => e.attendanceType === "checkin"),
        checkedOut: events.some((e) => e.attendanceType === "checkout"),
        events,
      };
    });

    const absentees = status.filter((s) => !s.checkedIn).map((s) => s.employee);

    res.json({ status, absentees });
  } catch (err) {
    console.error("getDailyStatus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getEmployeeDay(req, res) {
  try {
    const { employeeId, date } = req.query;
    if (!employeeId) {
      return res.status(400).json({ error: "employeeId is required" });
    }

    const day = date ? new Date(date) : new Date();
    const startOfDay = new Date(day);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(day);
    endOfDay.setHours(23, 59, 59, 999);

    const employee = await Employee.findById(employeeId).select("firstName lastName");

    const plans = await PlanConfiguration.find({
      performer: employeeId,
      period: { $gte: startOfDay, $lte: endOfDay },
      status: { $in: ["i_went", "i_left", "completed"] },
    }).populate("hospital", "name lat lng");

    const planIds = plans.map((p) => p._id);
    const planAddresses = await Address.find({
      addressableType: "PlanConfiguration",
      addressableId: { $in: planIds },
    }).sort({ createdAt: 1 });

    const addressesByPlan = new Map();
    planAddresses.forEach((a) => {
      const key = String(a.addressableId);
      if (!addressesByPlan.has(key)) addressesByPlan.set(key, []);
      addressesByPlan.get(key).push(a);
    });

    const planVisits = plans.map((plan) => {
      const addrs = addressesByPlan.get(String(plan._id)) || [];
      const checkin = addrs.find((a) => a.addressType === "performer_i_went_location");
      const checkout = addrs.find((a) => a.addressType === "performer_i_left_location");

      const checkinDistance =
        checkin && plan.hospital?.lat != null && plan.hospital?.lng != null
          ? distanceInMeters(checkin.lat, checkin.lng, plan.hospital.lat, plan.hospital.lng)
          : null;
      const checkoutDistance =
        checkout && plan.hospital?.lat != null && plan.hospital?.lng != null
          ? distanceInMeters(checkout.lat, checkout.lng, plan.hospital.lat, plan.hospital.lng)
          : null;

      return {
        hospitalName: plan.hospital?.name || "უცნობი",
        hospitalLat: plan.hospital?.lat,
        hospitalLng: plan.hospital?.lng,
        checkinTime: checkin?.createdAt || null,
        checkoutTime: checkout?.createdAt || null,
        checkinDistance,
        checkoutDistance,
        durationMinutes:
          checkin && checkout
            ? Math.round((new Date(checkout.createdAt) - new Date(checkin.createdAt)) / 60000)
            : null,
      };
    });

    const standaloneAttendances = await Attendance.find({
      employee: employeeId,
      attendanceTime: { $gte: startOfDay, $lte: endOfDay },
      viaPlan: null,
    }).sort({ attendanceTime: 1 });

    const standaloneVisits = [];
    let openCheckin = null;
    for (const att of standaloneAttendances) {
      if (att.attendanceType === "checkin") {
        if (openCheckin) {
          standaloneVisits.push({
            hospitalName: "სტანდარტული ჩექინი",
            hospitalLat: null,
            hospitalLng: null,
            checkinTime: openCheckin.attendanceTime,
            checkoutTime: null,
            checkinDistance: null,
            checkoutDistance: null,
            durationMinutes: null,
          });
        }
        openCheckin = att;
      } else if (att.attendanceType === "checkout") {
        standaloneVisits.push({
          hospitalName: "სტანდარტული ჩექინი",
          hospitalLat: null,
          hospitalLng: null,
          checkinTime: openCheckin?.attendanceTime || null,
          checkoutTime: att.attendanceTime,
          checkinDistance: null,
          checkoutDistance: null,
          durationMinutes: openCheckin
            ? Math.round((new Date(att.attendanceTime) - new Date(openCheckin.attendanceTime)) / 60000)
            : null,
        });
        openCheckin = null;
      }
    }
    if (openCheckin) {
      standaloneVisits.push({
        hospitalName: "სტანდარტული ჩექინი",
        hospitalLat: null,
        hospitalLng: null,
        checkinTime: openCheckin.attendanceTime,
        checkoutTime: null,
        checkinDistance: null,
        checkoutDistance: null,
        durationMinutes: null,
      });
    }

    let visits = [...planVisits, ...standaloneVisits]
      .filter((v) => v.checkinTime)
      .sort((a, b) => new Date(a.checkinTime) - new Date(b.checkinTime));

    for (let i = 1; i < visits.length; i++) {
      const prevCheckout = visits[i - 1].checkoutTime;
      const currentCheckin = visits[i].checkinTime;
      visits[i].travelMinutesFromPrevious =
        prevCheckout && currentCheckin
          ? Math.round((new Date(currentCheckin) - new Date(prevCheckout)) / 60000)
          : null;
    }

    res.json({
      employeeName: employee?.name || "უცნობი",
      date: startOfDay,
      visits,
    });
  } catch (err) {
    console.error("getEmployeeDay failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getMyStatus(req, res) {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const records = await Attendance.find({
      employee: req.employee._id,
      attendanceTime: { $gte: startOfDay },
    }).sort({ attendanceTime: -1 });

    const latest = records[0];
    const nextAction = latest?.attendanceType === "checkin" ? "checkout" : "checkin";

    res.json({ nextAction });
  } catch (err) {
    console.error("getMyStatus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
