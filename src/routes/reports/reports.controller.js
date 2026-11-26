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
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";
import { peopleOf, filtersFor, narrowTo } from "../../utils/divisionFilters.js";

// GET /api/reports/efficiency/filters -> divisions / groups this user may see
export async function getEfficiencyFilters(req, res) {
  try {
    res.json(await filtersFor(await getScopeEmployeeIds(req.employee)));
  } catch (err) {
    console.error("getEfficiencyFilters failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getEfficiencyReport(req, res) {
  try {
    const { from, to, employee, hospital } = req.query;

    // finished visits only — planned / cancelled / "arrived but not left" are not counted
    const planFilter = { status: { $in: ["completed", "i_left"] } };
    if (from || to) {
      planFilter.period = {};
      if (from) planFilter.period.$gte = dayStart(from);
      if (to) planFilter.period.$lte = dayEnd(to);
    } else {
      // no dates picked -> last 7 days, never the whole history (15k+ visits)
      planFilter.period = { $gte: new Date(Date.now() - 7 * 86400000) };
    }
    if (employee) planFilter.performer = employee;
    if (hospital) planFilter.hospital = hospital;
    // division / group filter
    const only = await peopleOf(req.query.section, req.query.group);
    if (only) planFilter.performer = narrowTo(planFilter.performer, only);

    const effScope = await getScopeEmployeeIds(req.employee);
    if (effScope) {
      const scopeSet = new Set(effScope.map(String));
      if (planFilter.performer) {
        if (!scopeSet.has(String(planFilter.performer))) planFilter.performer = { $in: [] };
      } else {
        planFilter.performer = { $in: effScope };
      }
    }

    const plans = await PlanConfiguration.find(planFilter)
      .populate("performer", "firstName lastName")
      .populate("hospital", "name")
      .populate("pharmacy", "pharmacyName")
      .select("period performer hospital pharmacy")
      .lean();

    const planIds = plans.map((p) => p._id);
    const planById = new Map(plans.map((p) => [String(p._id), p]));

    const pcds = await PlanConfigurationDoctor.find({
      planConfiguration: { $in: planIds },
    })
      .select("planConfiguration doctor")
      .populate({ path: "doctor", select: "firstName lastName profile", populate: { path: "profile", select: "name" } })
      .lean();

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

// employees of one division (its groups' members + the division head)
export async function divisionEmployeeIds(sectionId) {
  const sec = await Section.findById(sectionId).select("head").lean();
  const gids = await Group.find({ section: sectionId }).distinct("_id");
  const ids = (await Employee.find({ group: { $in: gids } }).distinct("_id")).map(String);
  if (sec?.head) ids.push(String(sec.head));
  return ids;
}

// GET /api/reports/reimbursement/divisions
export async function getReimbursementDivisions(req, res) {
  try {
    res.json(await Section.find({ name: /DIVIZION/i }).sort({ name: 1 }).select("name").lean());
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
}

export async function getReimbursementReport(req, res) {
  try {
    const { from, to, employee } = req.query;

    // only hospital visits can be reimbursed (pharmacy-only plans have no region)
    const filter = { status: { $in: ["completed", "i_left"] }, hospital: { $ne: null } };
    if (from || to) {
      filter.period = {};
      if (from) filter.period.$gte = dayStart(from);
      if (to) filter.period.$lte = dayEnd(to);
    } else {
      // no dates picked -> last 7 days, never the whole history
      filter.period = { $gte: new Date(Date.now() - 7 * 86400000) };
    }
    if (employee) filter.performer = employee;

    // scope: division/group managers only see their own people
    {
      const rScope = await getScopeEmployeeIds(req.employee);
      if (rScope) {
        const scopeSet = new Set(rScope.map(String));
        if (filter.performer) {
          if (!scopeSet.has(String(filter.performer))) filter.performer = { $in: [] };
        } else {
          filter.performer = { $in: rScope };
        }
      }
    }

    if (req.query.division) {
      const dIds = new Set(await divisionEmployeeIds(req.query.division));
      if (typeof filter.performer === "string" || filter.performer?._bsontype) {
        if (!dIds.has(String(filter.performer))) filter.performer = { $in: [] };
      } else if (filter.performer?.$in) {
        filter.performer = { $in: filter.performer.$in.filter((id) => dIds.has(String(id))) };
      } else {
        filter.performer = { $in: [...dIds] };
      }
    }

    const plans = await PlanConfiguration.find(filter)
      .populate("performer", "firstName lastName")
      .populate({ path: "hospital", select: "region", populate: { path: "region", select: "name reimbursementAmt" } })
      .select("period performer hospital")
      .sort({ iWentAt: 1 })
      .lean();

    const seen = new Map();
    plans.forEach((plan) => {
      if (!plan.hospital?.region) return;
      const dateKey = new Date(plan.period).toISOString().slice(0, 10);
      const empId = String(plan.performer?._id || "");
      const key = `${dateKey}_${empId}`;
      if (seen.has(key)) return;

      seen.set(key, {
        date: plan.period,
        employeeId: empId,
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

    // only hospital visits can be reimbursed (pharmacy-only plans have no region)
    const filter = { status: { $in: ["completed", "i_left"] }, hospital: { $ne: null } };
    if (from || to) {
      filter.period = {};
      if (from) filter.period.$gte = dayStart(from);
      if (to) filter.period.$lte = dayEnd(to);
    } else {
      // no dates picked -> last 7 days, never the whole history
      filter.period = { $gte: new Date(Date.now() - 7 * 86400000) };
    }
    if (employee) filter.performer = employee;

    // scope: division/group managers only see their own people
    {
      const rScope = await getScopeEmployeeIds(req.employee);
      if (rScope) {
        const scopeSet = new Set(rScope.map(String));
        if (filter.performer) {
          if (!scopeSet.has(String(filter.performer))) filter.performer = { $in: [] };
        } else {
          filter.performer = { $in: rScope };
        }
      }
    }

    const plans = await PlanConfiguration.find(filter)
      .populate("performer", "firstName lastName")
      .populate({ path: "hospital", select: "region", populate: { path: "region", select: "name reimbursementAmt" } })
      .select("period performer hospital")
      .sort({ iWentAt: 1 })
      .lean();

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

// A date picked in the UI ("2026-10-07") means that whole day in Georgia (UTC+4):
// from 00:00 to 23:59:59. new Date("2026-10-07") alone is midnight UTC, which
// cut off every check-in made on the last day of the range (incl. today).
function dayStart(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00+04:00`) : new Date(s);
}
function dayEnd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T23:59:59.999+04:00`) : new Date(s);
}

export async function getAttendanceReport(req, res) {
  try {
    const filter = {};
    if (req.query.from || req.query.to) {
      filter.attendanceTime = {};
      if (req.query.from) filter.attendanceTime.$gte = dayStart(req.query.from);
      if (req.query.to) filter.attendanceTime.$lte = dayEnd(req.query.to);
    } else {
      // no dates picked -> last 7 days, never the whole history
      filter.attendanceTime = { $gte: new Date(Date.now() - 7 * 86400000) };
    }
    if (req.query.employee) filter.employee = req.query.employee;

    const attScope = await getScopeEmployeeIds(req.employee);
    if (attScope) {
      const scopeSet = new Set(attScope.map(String));
      if (filter.employee) {
        if (!scopeSet.has(String(filter.employee))) filter.employee = { $in: [] };
      } else {
        filter.employee = { $in: attScope };
      }
    }

    const records = await Attendance.find(filter)
      .populate("employee", "firstName lastName")
      .select("employee attendanceTime attendanceType attendanceStatus viaPlan")
      .sort({ attendanceTime: -1 })
      .lean();

    const standaloneIds = records.filter((r) => !r.viaPlan).map((r) => r._id);
    const planIds = records.filter((r) => r.viaPlan).map((r) => r.viaPlan);

    const [standaloneAddresses, planAddresses] = await Promise.all([
      Address.find({ addressableType: "Attendance", addressableId: { $in: standaloneIds } })
        .select("addressableId cleanAddress")
        .lean(),
      Address.find({ addressableType: "PlanConfiguration", addressableId: { $in: planIds } })
        .select("addressableId addressType cleanAddress")
        .lean(),
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
// One row per employee:
//   visits          = finished visits only (completed / i_left) — not planned, cancelled or still "arrived"
//   doctorsVisited  = different doctors seen on those visits
//   totalPaidAmount = what was paid to doctors (active budgets, by budget date)
// month mode only (these are stored per month):
//   totalPrescriptionAmount = prescriptions entered × drug price            (Prescription entry)
//   targetAmount            = the employee's plan × drug price              (Employee plans)
//   salesAmount             = the employee's pharmacy sales × drug price    (Employee sales)
//   fulfillment             = salesAmount ÷ targetAmount
const DONE_VISIT = ["completed", "i_left"];
const SP_H12 = 12 * 3600e3;
const spR2 = (n) => Math.round((n || 0) * 100) / 100;

export async function getStaffPerformanceReport(req, res) {
  try {
    const { default: mongoose } = await import("mongoose");
    const { default: EmployeeSale } = await import("../../models/EmployeeSale.js");
    const { default: EmployeeTarget } = await import("../../models/EmployeeTarget.js");
    const { default: MedicineTarget } = await import("../../models/MedicineTarget.js");
    const { default: Drug } = await import("../../models/Drug.js");
    const isId = (v) => v && mongoose.isValidObjectId(String(v));

    const { section, group, employee, mode, month, from, to } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);

    // 1. who: one employee / a group / a division / everyone (active) — inside what the viewer may see
    let ids = null; // null = all active
    if (isId(employee)) ids = [String(employee)];
    else if (isId(group) || isId(section)) {
      let groupIds = [];
      if (isId(group)) groupIds = [String(group)];
      else {
        const sec = await Section.findById(section).select("groups head").lean();
        const linked = await Group.find({ section }).distinct("_id");
        groupIds = [...new Set([...(sec?.groups || []).map(String), ...linked.map(String)])];
      }
      const set = new Set();
      (await Employee.find({ group: { $in: groupIds } }).distinct("_id")).forEach((id) => set.add(String(id)));
      (await Group.find({ _id: { $in: groupIds } }).select("head members").lean()).forEach((g) => {
        if (g.head) set.add(String(g.head));
        (g.members || []).forEach((m) => set.add(String(m)));
      });
      if (!isId(group)) {
        const sec = await Section.findById(section).select("head").lean();
        if (sec?.head) set.add(String(sec.head));
      }
      ids = [...set];
    }
    const scopeIds = await getScopeEmployeeIds(req.employee);
    if (scopeIds) {
      const allowed = new Set(scopeIds.map(String));
      ids = (ids || [...allowed]).filter((id) => allowed.has(id));
    }
    const empFilter = { isActive: true };
    if (ids) empFilter._id = { $in: ids };
    if (isId(employee)) delete empFilter.isActive; // a chosen person is shown even if inactive
    const people = await Employee.find(empFilter).select("firstName lastName").sort({ firstName: 1, lastName: 1 }).lean();
    const empIds = people.map((p) => p._id);

    // 2. when
    const isMonthMode = mode === "month" && /^\d{4}-\d{2}$/.test(month || "");
    let rangeStart, rangeEnd, entryWin;
    if (isMonthMode) {
      const [y, m] = month.split("-").map(Number);
      rangeStart = new Date(`${month}-01T00:00:00+04:00`); // Georgian calendar month
      const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
      rangeEnd = new Date(new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+04:00`).getTime() - 1);
      // month records ("the 1st") are saved at UTC or Tbilisi midnight -> a window that catches both
      entryWin = { $gte: new Date(Date.UTC(y, m - 1, 1) - SP_H12), $lt: new Date(Date.UTC(y, m, 1) - SP_H12) };
    } else {
      rangeStart = from ? dayStart(from) : new Date(`${new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 8)}01T00:00:00+04:00`);
      rangeEnd = to ? dayEnd(to) : new Date();
    }
    const when = { $gte: rangeStart, $lte: rangeEnd };

    // 3. numbers for everyone at once
    const row = new Map(people.map((p) => [String(p._id), {
      employeeId: p._id,
      employeeName: `${p.firstName || ""} ${p.lastName || ""}`.trim(),
      visits: 0, doctorsVisited: 0, totalPaidAmount: 0,
    }]));

    const plans = await PlanConfiguration.find({ performer: { $in: empIds }, period: when, status: { $in: DONE_VISIT } }).select("_id performer").lean();
    const performerOf = new Map(plans.map((p) => [String(p._id), String(p.performer)]));
    plans.forEach((p) => { const r = row.get(String(p.performer)); if (r) r.visits += 1; });
    if (plans.length) {
      const seen = new Map(); // employee -> Set(doctor)
      (await PlanConfigurationDoctor.find({ planConfiguration: { $in: plans.map((p) => p._id) } }).select("planConfiguration doctor").lean())
        .forEach((d) => {
          const e = performerOf.get(String(d.planConfiguration));
          if (!e) return;
          if (!seen.has(e)) seen.set(e, new Set());
          seen.get(e).add(String(d.doctor || d._id));
        });
      seen.forEach((s, e) => { const r = row.get(e); if (r) r.doctorsVisited = s.size; });
    }

    (await Budget.aggregate([
      { $match: { employee: { $in: empIds }, date: when, isActive: { $ne: false } } },
      { $group: { _id: "$employee", sum: { $sum: "$paidAmount" } } },
    ])).forEach((b) => { const r = row.get(String(b._id)); if (r) r.totalPaidAmount = spR2(b.sum); });

    if (isMonthMode) {
      const price = new Map((await Drug.find({}).select("price").lean()).map((d) => [String(d._id), d.price || 0]));
      row.forEach((r) => Object.assign(r, { totalPrescriptionAmount: 0, prescriptionBoxes: 0, targetAmount: 0, targetBoxes: 0, salesAmount: 0, salesBoxes: 0 }));

      (await DoctorEntryItem.find({ employee: { $in: empIds }, period: entryWin }).select("employee drug prescription").lean())
        .forEach((it) => {
          const r = row.get(String(it.employee));
          if (!r) return;
          r.prescriptionBoxes += it.prescription || 0;
          r.totalPrescriptionAmount += (it.prescription || 0) * (price.get(String(it.drug)) || 0);
        });

      // the plan (EmployeeTarget) and pharmacy sales (EmployeeSale): header per employee + drug lines
      const linesOf = async (Model, type, boxKey, amountKey) => {
        const heads = await Model.find({ employee: { $in: empIds }, date: entryWin }).select("_id employee").lean();
        if (!heads.length) return;
        const owner = new Map(heads.map((h) => [String(h._id), String(h.employee)]));
        (await MedicineTarget.find({ medicineTargatableType: type, medicineTargatableId: { $in: heads.map((h) => h._id) } }).select("medicineTargatableId drug totalNoOfBoxes").lean())
          .forEach((l) => {
            const r = row.get(owner.get(String(l.medicineTargatableId)));
            if (!r) return;
            r[boxKey] += l.totalNoOfBoxes || 0;
            r[amountKey] += (l.totalNoOfBoxes || 0) * (price.get(String(l.drug)) || 0);
          });
      };
      await linesOf(EmployeeTarget, "EmployeeTarget", "targetBoxes", "targetAmount");
      await linesOf(EmployeeSale, "EmployeeSale", "salesBoxes", "salesAmount");

      row.forEach((r) => {
        ["totalPrescriptionAmount", "targetAmount", "salesAmount", "prescriptionBoxes", "targetBoxes", "salesBoxes"].forEach((k) => { r[k] = spR2(r[k]); });
        r.fulfillment = r.targetAmount > 0 ? Math.round((r.salesAmount / r.targetAmount) * 1000) / 10 : null;
      });
    }

    // 4. totals + page
    const all = [...row.values()];
    const sum = (k) => spR2(all.reduce((s, r) => s + (r[k] || 0), 0));
    const totals = { visits: sum("visits"), doctorsVisited: sum("doctorsVisited"), totalPaidAmount: sum("totalPaidAmount") };
    if (isMonthMode) {
      Object.assign(totals, { totalPrescriptionAmount: sum("totalPrescriptionAmount"), targetAmount: sum("targetAmount"), salesAmount: sum("salesAmount") });
      totals.fulfillment = totals.targetAmount > 0 ? Math.round((totals.salesAmount / totals.targetAmount) * 1000) / 10 : null;
    }
    const total = all.length;
    res.json({
      docs: all.slice((page - 1) * limit, page * limit),
      total,
      page,
      pages: Math.max(Math.ceil(total / limit), 1),
      limit,
      totals,
      mode: isMonthMode ? "month" : "range",
    });
  } catch (err) {
    console.error("getStaffPerformanceReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
