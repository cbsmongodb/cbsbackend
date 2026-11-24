import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import PlanConfiguration from "../../models/PlanConfiguration.js";
import PlanConfigurationDoctor from "../../models/PlanConfigurationDoctor.js";
import DoctorEntrySummary from "../../models/DoctorEntrySummary.js";
import CoefficientOverride from "../../models/CoefficientOverride.js";
import EmployeeSale from "../../models/EmployeeSale.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import DrugBonus from "../../models/DrugBonus.js";
import Drug from "../../models/Drug.js";
import { budgetSumsByDoctor } from "../../utils/budgetSync.js";
import { getScopeEmployeeIds, canSeeEmployee } from "../../utils/groupVisibility.js";
import mongoose from "mongoose";
import Doctor from "../../models/Doctor.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";
import Section from "../../models/Section.js";
import { filterScope } from "../finance/finance.controller.js";
import { drugBonuses, doctorBonuses, resolveBonuses, parseMonth, employeeArea } from "../../utils/bonuses.js";

function normalizeToMonthStart(dateLike) {
  let value = dateLike;
  if (typeof value === "string" && value.includes("/")) {
    const [mm, yyyy] = value.split("/");
    value = `${yyyy}-${mm}-01`;
  }
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// run async jobs with a small concurrency limit (keeps the DB connection pool happy)
async function runLimited(jobs, limit = 8) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      await job();
    }
  });
  await Promise.all(workers);
}

function previousPeriodOf(period) {
  const d = new Date(period);
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}


// real sales the reps type in on "Sales from pharmacies" (EmployeeSale + its drug lines),
// per drug, for one employee and one month -> Map(drugId -> boxes)
async function pharmacySalesByDrug(employeeId, period) {
  const start = new Date(period);
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  // half a day of slack so dates saved at Georgian or UTC midnight both fall in the month
  const from = new Date(start.getTime() - 12 * 3600e3);
  const to = new Date(next.getTime() - 12 * 3600e3);
  const sales = await EmployeeSale.find({ employee: employeeId, date: { $gte: from, $lt: to } }).select("_id").lean();
  const map = new Map();
  if (!sales.length) return map;
  const lines = await MedicineTarget.find({
    medicineTargatableType: "EmployeeSale",
    medicineTargatableId: { $in: sales.map((x) => x._id) },
  }).select("drug totalNoOfBoxes").lean();
  lines.forEach((l) => {
    const k = String(l.drug);
    map.set(k, (map.get(k) || 0) + (l.totalNoOfBoxes || 0));
  });
  return map;
}


// bonus per box for a month: the drug's monthly bonus (Drugs page "Bonuses by month"),
// otherwise the drug's general bonus -> Map(drugId -> value). Drugs with neither are left out.
async function bonusesForPeriod(drugIds, period, area = "tbilisi") {
  // Bonuses page: month bonus -> old general bonus -> default 1 (utils/bonuses.js)
  const byDrug = await drugBonuses(parseMonth(period), drugIds, area);
  return new Map([...byDrug].map(([id, b]) => [id, b.value]));
}

export async function recalculateForPeriod(employeeId, period) {
  const items = await DoctorEntryItem.find({ employee: employeeId, period }).lean();
  if (items.length === 0) return;

  // Step 1 — coefficient & totalBudget per item (drug totals aggregated
  // across all doctors for this employee+drug+period, same as before).
  const totalsByDrug = {};
  for (const item of items) {
    const key = String(item.drug);
    if (!totalsByDrug[key]) totalsByDrug[key] = { sale: 0, prescription: 0 };
    totalsByDrug[key].sale += item.sale || 0;
    totalsByDrug[key].prescription += item.prescription || 0;
  }

  // real pharmacy sales win over the doctors' typed "sale" numbers (when they were entered)
  const pharmacy = await pharmacySalesByDrug(employeeId, period);
  for (const [drugKey, boxes] of pharmacy) {
    if (totalsByDrug[drugKey]) totalsByDrug[drugKey].sale = boxes;
  }

  const overrides = await CoefficientOverride.find({ employee: employeeId, period }).select("drug coefficient").lean();
  const overrideByDrug = new Map(overrides.map((o) => [String(o.drug), o.coefficient]));

  const coefficientByItemId = new Map();
  const totalBudgetByItemId = new Map();

  for (const item of items) {
    const drugKey = String(item.drug);
    let coefficient;

    if (overrideByDrug.has(drugKey)) {
      coefficient = overrideByDrug.get(drugKey);
    } else {
      const totals = totalsByDrug[drugKey];
      coefficient = totals.prescription > 0 ? totals.sale / totals.prescription : 0;
    }

    const totalBudget = item.prescription * (item.budget || 0) * coefficient;
    coefficientByItemId.set(String(item._id), Math.round(coefficient * 10000) / 10000);
    totalBudgetByItemId.set(String(item._id), Math.round(totalBudget * 100) / 100);
  }

  // Step 2 — plannedBudget per doctor = sum of totalBudget across all of
  // that doctor's drugs this period (matches the spreadsheet's
  // "PALAGAEMI BIUJET" = SUM of every drug's "SUM BIUJET" column).
  const plannedBudgetByDoctor = {};
  for (const item of items) {
    const doctorKey = String(item.doctor);
    const tb = totalBudgetByItemId.get(String(item._id)) || 0;
    plannedBudgetByDoctor[doctorKey] = (plannedBudgetByDoctor[doctorKey] || 0) + tb;
  }

  // Step 3 — carry-forward: this month's analysisOfPreviousMonth comes
  // from last month's analysisOfCurrentMonth for the same
  // employee+doctor+drug (rolling balance across months).
  const prevPeriod = previousPeriodOf(period)
  const prevItems = await DoctorEntryItem.find({
    employee: employeeId,
    period: prevPeriod,
    doctor: { $in: items.map((i) => i.doctor) },
  })
    .select("doctor drug analysisOfCurrentMonth")
    .lean()
  const prevAnalysisByKey = new Map(
    prevItems.map((p) => [`${p.doctor}_${p.drug}`, p.analysisOfCurrentMonth || 0])
  )

  const bulkOps = items.map((item) => {
    const doctorKey = String(item.doctor)
    const plannedBudget = Math.round((plannedBudgetByDoctor[doctorKey] || 0) * 100) / 100
    const issuedBudget = item.issuedBudget || 0
    const difference = Math.round((plannedBudget - issuedBudget) * 100) / 100
    const analysisOfPreviousMonth = prevAnalysisByKey.get(`${item.doctor}_${item.drug}`) || 0
    const budgetCalculation = Math.round((difference + analysisOfPreviousMonth) * 100) / 100
    const analysisOfCurrentMonth = budgetCalculation

    return {
      updateOne: {
        filter: { _id: item._id },
        update: {
          $set: {
            coefficient: coefficientByItemId.get(String(item._id)),
            totalBudget: totalBudgetByItemId.get(String(item._id)),
            plannedBudget,
            difference,
            analysisOfPreviousMonth,
            budgetCalculation,
            analysisOfCurrentMonth,
          },
        },
      },
    }
  })

  if (bulkOps.length) await DoctorEntryItem.bulkWrite(bulkOps);
}

export async function getListing(req, res) {
  try {
    const { employee, period } = req.query;
    if (!employee || !period) {
      return res.status(400).json({ error: "employee and period are required" });
    }

    const scopeIds = await getScopeEmployeeIds(req.employee);
    if (scopeIds && !scopeIds.some((id) => String(id) === String(employee))) {
      return res.json([]);
    }

    const periodDate = normalizeToMonthStart(period);

    const items = await DoctorEntryItem.find({ employee, period: periodDate })
      .populate("doctor", "firstName lastName uniqueNumber")
      .populate("drug", "name price bonus")
      .populate("hospital", "name")
      .sort({ doctor: 1 })
      .lean();

    const summaries = await DoctorEntrySummary.find({ employee, period: periodDate }).lean();
    const summaryByDrug = new Map(summaries.map((s) => [String(s.drug), s]));

    const pharmacy = await pharmacySalesByDrug(employee, periodDate);
    res.json({
      items,
      drugTotals: [...summaryByDrug.values()],
      pharmacySales: Object.fromEntries(pharmacy),
      bonuses: Object.fromEntries(await bonusesForPeriod((await Drug.find({ isActive: { $ne: false } }).select("_id").lean()).map((d) => d._id), periodDate, await employeeArea(employee))),
      doctorBonuses: Object.fromEntries(await doctorBonuses(parseMonth(periodDate), {}, await employeeArea(employee))),
    });
  } catch (err) {
    console.error("getListing failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getDoctorSnapshot(req, res) {
  try {
    const { employee, doctor, period } = req.query;
    const periodDate = normalizeToMonthStart(period);

    const currentItems = await DoctorEntryItem.find({ employee, doctor, period: periodDate })
      .populate("drug", "name price")
      .populate("hospital", "name")
      .lean();

    const previousItem = await DoctorEntryItem.findOne({
      employee,
      doctor,
      period: { $lt: periodDate },
    })
      .sort({ period: -1 })
      .populate("hospital", "name")
      .lean();

    res.json({
      hospital: currentItems[0]?.hospital || previousItem?.hospital || null,
      bank: currentItems[0]?.bank || previousItem?.bank,
      visits: currentItems[0]?.visits || "",
      issuedBudget: currentItems[0]?.issuedBudget || 0,
      drugs: currentItems.map((item) => ({
        drugId: item.drug._id,
        drugName: item.drug.name,
        price: item.drug.price,
        budget: item.budget,
        prescription: item.prescription,
        quota: item.quota,
        sale: item.sale,
      })),
    });
  } catch (err) {
    console.error("getDoctorSnapshot failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function submitEntries(req, res) {
  try {
    const { employee, period, doctorEntries } = req.body;
    if (!employee || !period || !Array.isArray(doctorEntries)) {
      return res.status(400).json({ error: "employee, period, and doctorEntries are required" });
    }

    const periodDate = normalizeToMonthStart(period);
    // issued budget: typed number stays ("manual"); empty -> sum of this month's budgets
    const budgetSums = await budgetSumsByDoctor(employee, { y: periodDate.getFullYear(), m: periodDate.getMonth() });
    // issuedOnlyFromBudgets: the issued budget is never typed on this form any more —
    // it comes from the Budgets page; a number someone typed earlier stays as it is
    const existingIssued = new Map(
      (await DoctorEntryItem.find({ employee, period: periodDate }).select("doctor issuedBudget issuedBudgetSource").lean())
        .map((i) => [String(i.doctor), i])
    );
    const issuedFor = (entry) => {
      const fromBudgets = budgetSums[String(entry.doctorId)] || 0;
      const old = existingIssued.get(String(entry.doctorId));
      const typedEarlier = old && old.issuedBudget && old.issuedBudgetSource !== "budget";
      // same value on every drug line of the doctor (a newly added drug too)
      if (typedEarlier) return { issuedBudget: old.issuedBudget, issuedBudgetSource: "manual" };
      if (fromBudgets) return { issuedBudget: fromBudgets, issuedBudgetSource: "budget" };
      return { issuedBudget: 0 };
    };
    const bonus = await resolveBonuses(
      parseMonth(periodDate),
      doctorEntries.flatMap((e) => (e.drugs || []).filter((d) => d.drugId).map((d) => ({ doctor: e.doctorId, drug: d.drugId }))),
      { area: await employeeArea(employee) }
    );

    // one write per doctor+drug (last one wins, like before) and ONE summary
    // write per drug, run in parallel — instead of 2 sequential DB round trips
    // for every single row (that made a big form take tens of seconds)
    const rowsByKey = new Map();
    const rxByDrug = new Map();
    for (const entry of doctorEntries) {
      for (const drugRow of entry.drugs || []) {
        const key = `${entry.doctorId}|${drugRow.drugId}`;
        rowsByKey.delete(key);
        rowsByKey.set(key, { entry, drugRow });
        const dk = String(drugRow.drugId);
        rxByDrug.set(dk, (rxByDrug.get(dk) || 0) + (drugRow.prescription || 0));
      }
    }

    await runLimited(
      [...rowsByKey.values()].map(({ entry, drugRow }) => () =>
        DoctorEntryItem.findOneAndUpdate(
          { employee, doctor: entry.doctorId, drug: drugRow.drugId, period: periodDate },
          {
            employee,
            doctor: entry.doctorId,
            drug: drugRow.drugId,
            hospital: entry.hospitalId || null,
            period: periodDate,
            bank: entry.bank || undefined, // empty = not chosen (no enum error)
            visits: entry.visits || "",
            ...issuedFor(entry),
            quota: drugRow.quota || 0,
            prescription: drugRow.prescription || 0,
            // sale / budget: only when the form sent it (new rows don't -> stored values stay)
            ...(drugRow.sale !== undefined ? { sale: drugRow.sale || 0 } : {}),
            ...(bonus.has(`${entry.doctorId}|${drugRow.drugId}`)
              ? { budget: bonus.get(`${entry.doctorId}|${drugRow.drugId}`) }
              : drugRow.budget !== undefined ? { budget: drugRow.budget || 0 } : {}),
          },
          { upsert: true, new: true, runValidators: true }
        )
      )
    );

    await runLimited(
      [...rxByDrug.entries()].map(([drugId, rx]) => () =>
        DoctorEntrySummary.findOneAndUpdate(
          { employee, drug: drugId, period: periodDate },
          { $inc: { prescription: rx } },
          { upsert: true }
        )
      )
    );

    await recalculateForPeriod(employee, periodDate);

    const items = await DoctorEntryItem.find({ employee, period: periodDate })
      .populate("doctor", "firstName lastName")
      .populate("drug", "name")
      .lean();

    res.status(201).json({ success: true, items });
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("submitEntries failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateEntryItem(req, res) {
  try {
    const owner = await DoctorEntryItem.findById(req.params.id).select("employee").lean();
    if (!owner) return res.status(404).json({ error: "Entry not found" });
    if (!(await canSeeEmployee(req.employee, owner.employee))) return res.status(403).json({ error: "Forbidden" });
    delete req.body.employee;
    const item = await DoctorEntryItem.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) return res.status(404).json({ error: "Entry not found" });

    await recalculateForPeriod(item.employee, item.period);
    const refreshed = await DoctorEntryItem.findById(item._id)
      .populate("doctor", "firstName lastName")
      .populate("drug", "name")
      .lean();

    res.json(refreshed);
  } catch (err) {
    console.error("updateEntryItem failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteEntryItem(req, res) {
  try {
    const owner = await DoctorEntryItem.findById(req.params.id).select("employee").lean();
    if (!owner) return res.status(404).json({ error: "Entry not found" });
    if (!(await canSeeEmployee(req.employee, owner.employee))) return res.status(403).json({ error: "Forbidden" });
    const item = await DoctorEntryItem.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ error: "Entry not found" });

    await recalculateForPeriod(item.employee, item.period);

    res.json({ success: true });
  } catch (err) {
    console.error("deleteEntryItem failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteEntries(req, res) {
  try {
    const { employee, period } = req.query;
    const doctorIds = [].concat(req.query.doctorIds || []);
    const drugIds = [].concat(req.query.drugIds || []);

    if (!employee || !period) {
      return res.status(400).json({ error: "employee and period are required" });
    }
    if (!(await canSeeEmployee(req.employee, employee))) return res.status(403).json({ error: "Forbidden" });
    if (doctorIds.length === 0 && drugIds.length === 0) {
      return res.status(400).json({ error: "Select at least one doctor row or drug to delete" });
    }

    const periodDate = normalizeToMonthStart(period);
    const filter = { employee, period: periodDate };
    const orConditions = [];
    if (doctorIds.length) orConditions.push({ doctor: { $in: doctorIds } });
    if (drugIds.length) orConditions.push({ drug: { $in: drugIds } });
    filter.$or = orConditions;

    const result = await DoctorEntryItem.deleteMany(filter);
    if (result.deletedCount === 0) {
      return res.status(400).json({ error: "Nothing matched the selected records" });
    }

    const remaining = await DoctorEntryItem.find({ employee, period: periodDate }).distinct("drug");
    await DoctorEntrySummary.deleteMany({
      employee,
      period: periodDate,
      drug: { $nin: remaining },
    });

    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error("deleteEntries failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getCoefficientOverrides(req, res) {
  try {
    const { employee, period } = req.query;
    if (!employee || !period) {
      return res.status(400).json({ error: "employee and period are required" });
    }
    const periodDate = normalizeToMonthStart(period);

    const overrides = await CoefficientOverride.find({ employee, period: periodDate })
      .populate("drug", "name")
      .populate("setBy", "firstName lastName")
      .lean();

    res.json(overrides);
  } catch (err) {
    console.error("getCoefficientOverrides failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function setCoefficientOverride(req, res) {
  try {
    const { employee, drug, period, coefficient, note } = req.body;
    if (!employee || !drug || !period || coefficient === undefined) {
      return res.status(400).json({ error: "employee, drug, period, and coefficient are required" });
    }

    const periodDate = normalizeToMonthStart(period);

    const override = await CoefficientOverride.findOneAndUpdate(
      { employee, drug, period: periodDate },
      { employee, drug, period: periodDate, coefficient, note, setBy: req.employee._id },
      { upsert: true, new: true, runValidators: true }
    );

    await recalculateForPeriod(employee, periodDate);

    const populated = await override.populate("drug", "name");
    res.status(201).json(populated);
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("setCoefficientOverride failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteCoefficientOverride(req, res) {
  try {
    const override = await CoefficientOverride.findByIdAndDelete(req.params.id);
    if (!override) return res.status(404).json({ error: "Not found" });

    await recalculateForPeriod(override.employee, override.period);

    res.json({ success: true });
  } catch (err) {
    console.error("deleteCoefficientOverride failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/doctor-entry-items/budget-sums?employee=&period=MM/YYYY
// -> { doctorId: paid sum of this month's budgets } (fills "issued budget")
export async function getBudgetSums(req, res) {
  try {
    const { employee, period } = req.query;
    const [mm, yyyy] = String(period || "").split("/").map(Number);
    if (!employee || !mm || !yyyy) return res.status(400).json({ error: "employee and period (MM/YYYY) are required" });
    const scopeIds = await getScopeEmployeeIds(req.employee);
    if (scopeIds && !scopeIds.some((id) => String(id) === String(employee))) return res.json({});
    res.json(await budgetSumsByDoctor(employee, { y: yyyy, m: mm - 1 }));
  } catch (err) {
    console.error("getBudgetSums failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/doctor-entry-items/visit-counts?employee=&period=MM/YYYY
// -> { doctorId: number of completed visits this month } (fills the "visits" field)
export async function getVisitCounts(req, res) {
  try {
    const { employee, period } = req.query;
    if (!employee || !period) return res.status(400).json({ error: "employee and period are required" });
    const [mm, yyyy] = String(period).split("/").map(Number);
    if (!mm || !yyyy) return res.status(400).json({ error: "period must be MM/YYYY" });
    const from = new Date(`${yyyy}-${String(mm).padStart(2, "0")}-01T00:00:00+04:00`);
    const nm = mm === 12 ? 1 : mm + 1, ny = mm === 12 ? yyyy + 1 : yyyy;
    const to = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+04:00`);
    const plans = await PlanConfiguration.find({
      performer: employee,
      period: { $gte: from, $lt: to },
      status: { $in: ["i_went", "i_left", "completed"] },
    }).select("_id").lean();
    const rows = await PlanConfigurationDoctor.find({ planConfiguration: { $in: plans.map((p) => p._id) } }).select("doctor").lean();
    const counts = {};
    rows.forEach((r) => { const k = String(r.doctor); counts[k] = (counts[k] || 0) + 1; });
    res.json(counts);
  } catch (err) {
    console.error("getVisitCounts failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// ================= sales list: everyone / division / group, with pages =================
const oid = (v) => v && mongoose.isValidObjectId(String(v));
const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/doctor-entry-items/filters — divisions, groups and who is in each (only what this user may see)
export async function getListingFilters(req, res) {
  try {
    const scope = await getScopeEmployeeIds(req.employee);
    const allowed = scope ? new Set(scope.map(String)) : null;
    const [sections, groups, people] = await Promise.all([
      Section.find().select("name groups head").sort({ name: 1 }).lean(),
      Group.find().select("name section head members").sort({ name: 1 }).lean(),
      Employee.find(allowed ? { _id: { $in: [...allowed] } } : {}).select("group").lean(),
    ]);
    const sectionOf = new Map();
    sections.forEach((s) => (s.groups || []).forEach((g) => sectionOf.set(String(g), String(s._id))));
    const byGroup = new Map();
    const add = (g, e) => {
      if (!g || !e || (allowed && !allowed.has(String(e)))) return;
      if (!byGroup.has(String(g))) byGroup.set(String(g), new Set());
      byGroup.get(String(g)).add(String(e));
    };
    people.forEach((p) => add(p.group, p._id));
    groups.forEach((g) => { add(g._id, g.head); (g.members || []).forEach((m) => add(g._id, m)); });
    const outGroups = groups
      .filter((g) => byGroup.has(String(g._id)))
      .map((g) => ({ id: String(g._id), name: g.name, section: g.section ? String(g.section) : sectionOf.get(String(g._id)) || null, employees: [...byGroup.get(String(g._id))] }));
    const used = new Set(outGroups.map((g) => g.section).filter(Boolean));
    // drugs: the active ones + any drug that already has entries
    const entered = await DoctorEntryItem.distinct("drug", allowed ? { employee: { $in: [...allowed].map((id) => new mongoose.Types.ObjectId(id)) } } : {});
    const drugs = await Drug.find({ $or: [{ isActive: { $ne: false } }, { _id: { $in: entered } }] }).select("name").sort({ name: 1 }).lean();
    res.json({
      drugs: drugs.map((d) => ({ _id: String(d._id), name: d.name })),
      sections: sections.filter((s) => used.has(String(s._id))).map((s) => ({ id: String(s._id), name: s.name, head: s.head ? String(s.head) : null })),
      groups: outGroups,
    });
  } catch (err) {
    console.error("getListingFilters failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/doctor-entry-items/page?period=MM/YYYY&employee=&section=&group=&q=&page=1&limit=50
export async function getListingPage(req, res) {
  try {
    const { period, employee } = req.query;
    if (!period) return res.status(400).json({ error: "period is required" });
    const periodDate = normalizeToMonthStart(period);
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));

    const filter = { period: periodDate };
    if (oid(employee)) {
      const scopeIds = await getScopeEmployeeIds(req.employee);
      if (scopeIds && !scopeIds.some((id) => String(id) === String(employee))) {
        return res.json({ items: [], count: 0, page: 1, limit, totals: {}, pharmacySales: {} });
      }
      filter.employee = new mongoose.Types.ObjectId(String(employee));
    } else {
      const scope = await filterScope(req); // role scope ∩ division / group
      if (scope) filter.employee = { $in: scope };
    }

    // one drug
    if (oid(req.query.drug)) filter.drug = new mongoose.Types.ObjectId(String(req.query.drug));

    // search: doctor (name / ID), drug or rep
    const q = String(req.query.q || "").trim();
    if (q) {
      const words = q.split(/\s+/).map((w) => new RegExp(rxEsc(w), "i"));
      const personMatch = { $and: words.map((rx) => ({ $or: [{ firstName: rx }, { lastName: rx }] })) };
      const [docs, drugs, emps] = await Promise.all([
        Doctor.find({ $or: [personMatch, { uniqueNumber: new RegExp(rxEsc(q), "i") }] }).select("_id").limit(5000).lean(),
        Drug.find({ name: new RegExp(rxEsc(q), "i") }).select("_id").lean(),
        Employee.find(personMatch).select("_id").lean(),
      ]);
      filter.$or = [
        { doctor: { $in: docs.map((d) => d._id) } },
        { drug: { $in: drugs.map((d) => d._id) } },
        { employee: { $in: emps.map((e) => e._id) } },
      ];
    }

    const [count, sums, items] = await Promise.all([
      DoctorEntryItem.countDocuments(filter),
      DoctorEntryItem.aggregate([
        { $match: filter },
        { $group: { _id: null, prescription: { $sum: "$prescription" }, totalBudget: { $sum: "$totalBudget" }, issuedBudget: { $sum: "$issuedBudget" }, plannedBudget: { $sum: "$plannedBudget" }, difference: { $sum: "$difference" }, doctors: { $addToSet: "$doctor" }, employees: { $addToSet: "$employee" } } },
        { $project: { _id: 0, prescription: 1, totalBudget: 1, issuedBudget: 1, plannedBudget: 1, difference: 1, doctors: { $size: "$doctors" }, employees: { $size: "$employees" } } },
      ]),
      DoctorEntryItem.find(filter)
        .populate("employee", "firstName lastName")
        .populate("doctor", "firstName lastName uniqueNumber")
        .populate("drug", "name price bonus")
        .populate("hospital", "name")
        .sort({ employee: 1, doctor: 1, _id: 1 })
        .skip((pageNum - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    // a drug is chosen -> real pharmacy sales of it per rep ("Sales from pharmacies"), not prescriptions
    let byEmployee = null;
    if (filter.drug) {
      const next = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 1);
      const saleFilter = { date: { $gte: new Date(periodDate.getTime() - 12 * 3600e3), $lt: new Date(next.getTime() - 12 * 3600e3) } };
      if (filter.employee) saleFilter.employee = filter.employee; // one rep / the division / group / role scope
      const sales = await EmployeeSale.find(saleFilter).select("_id employee").lean();
      const empOf = new Map(sales.map((s) => [String(s._id), String(s.employee)]));
      const lines = sales.length
        ? await MedicineTarget.find({ medicineTargatableType: "EmployeeSale", medicineTargatableId: { $in: sales.map((s) => s._id) }, drug: filter.drug })
          .select("medicineTargatableId totalNoOfBoxes").lean()
        : [];
      const boxes = new Map();
      lines.forEach((l) => {
        const e = empOf.get(String(l.medicineTargatableId));
        if (e) boxes.set(e, (boxes.get(e) || 0) + (l.totalNoOfBoxes || 0));
      });
      const price = (await Drug.findById(filter.drug).select("price").lean())?.price || 0;
      const people = await Employee.find({ _id: { $in: [...boxes.keys()] } }).select("firstName lastName").lean();
      byEmployee = people
        .map((p) => {
          const n = Math.round((boxes.get(String(p._id)) || 0) * 100) / 100;
          return { employee: String(p._id), name: `${p.firstName || ""} ${p.lastName || ""}`.trim(), boxes: n, amount: Math.round(n * price * 100) / 100 };
        })
        .filter((r) => r.boxes !== 0)
        .sort((a, b) => b.boxes - a.boxes);
    }

    // pharmacy sales only for the reps on this page -> { "<employee>:<drug>": boxes }
    const pharmacySales = {};
    const reps = [...new Set(items.map((i) => String(i.employee?._id || i.employee)))];
    await runLimited(reps.map((emp) => async () => {
      const m = await pharmacySalesByDrug(emp, periodDate);
      m.forEach((v, drug) => { pharmacySales[`${emp}:${drug}`] = v; });
    }));

    res.json({ items, count, page: pageNum, limit, totals: sums[0] || {}, pharmacySales, byEmployee });
  } catch (err) {
    console.error("getListingPage failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
