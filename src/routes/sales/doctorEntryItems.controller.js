import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import DoctorEntrySummary from "../../models/DoctorEntrySummary.js";
import CoefficientOverride from "../../models/CoefficientOverride.js";

function normalizeToMonthStart(dateLike) {
  const d = new Date(dateLike);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function previousPeriodOf(period) {
  const d = new Date(period);
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}

async function recalculateForPeriod(employeeId, period) {
  const items = await DoctorEntryItem.find({ employee: employeeId, period });
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

  const overrides = await CoefficientOverride.find({ employee: employeeId, period });
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

    const periodDate = normalizeToMonthStart(
      period.includes("/") ? `${period.split("/")[1]}-${period.split("/")[0]}-01` : period
    );

    const items = await DoctorEntryItem.find({ employee, period: periodDate })
      .populate("doctor", "firstName lastName uniqueNumber")
      .populate("drug", "name price bonus")
      .populate("hospital", "name")
      .sort({ doctor: 1 });

    const summaries = await DoctorEntrySummary.find({ employee, period: periodDate });
    const summaryByDrug = new Map(summaries.map((s) => [String(s.drug), s]));

    res.json({
      items,
      drugTotals: [...summaryByDrug.values()],
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
      .populate("hospital", "name");

    const previousItem = await DoctorEntryItem.findOne({
      employee,
      doctor,
      period: { $lt: periodDate },
    })
      .sort({ period: -1 })
      .populate("hospital", "name");

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

    for (const entry of doctorEntries) {
      for (const drugRow of entry.drugs || []) {
        await DoctorEntryItem.findOneAndUpdate(
          { employee, doctor: entry.doctorId, drug: drugRow.drugId, period: periodDate },
          {
            employee,
            doctor: entry.doctorId,
            drug: drugRow.drugId,
            hospital: entry.hospitalId || null,
            period: periodDate,
            bank: entry.bank,
            visits: entry.visits || "",
            issuedBudget: entry.issuedBudget || 0,
            quota: drugRow.quota || 0,
            prescription: drugRow.prescription || 0,
            sale: drugRow.sale || 0,
            budget: drugRow.budget || 0,
          },
          { upsert: true, new: true, runValidators: true }
        );

        await DoctorEntrySummary.findOneAndUpdate(
          { employee, drug: drugRow.drugId, period: periodDate },
          {
            $inc: {
              prescription: drugRow.prescription || 0,
            },
          },
          { upsert: true }
        );
      }
    }

    await recalculateForPeriod(employee, periodDate);

    const items = await DoctorEntryItem.find({ employee, period: periodDate })
      .populate("doctor", "firstName lastName")
      .populate("drug", "name");

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
    const item = await DoctorEntryItem.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) return res.status(404).json({ error: "Entry not found" });

    await recalculateForPeriod(item.employee, item.period);
    const refreshed = await DoctorEntryItem.findById(item._id)
      .populate("doctor", "firstName lastName")
      .populate("drug", "name");

    res.json(refreshed);
  } catch (err) {
    console.error("updateEntryItem failed:", err);
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
      .populate("setBy", "firstName lastName");

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
