import LeaveBalance from "../../models/LeaveBalance.js";
import LeaveEntry from "../../models/LeaveEntry.js";
import RestDay from "../../models/RestDay.js";

const TYPE_TO_BALANCE_FIELD = {
  paid: "paidDaysTotal",
  unpaid: "unpaidDaysTotal",
  sick: "sickDaysTotal",
};

function toDateKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

async function countChargeableDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const restDays = await RestDay.find({ date: { $gte: start, $lte: end } });
  const restDayKeys = new Set(restDays.map((r) => toDateKey(r.date)));

  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    if (!restDayKeys.has(toDateKey(cursor))) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

export async function getBalance(req, res) {
  try {
    const { employee, year } = req.query;
    if (!employee) return res.status(400).json({ error: "employee is required" });
    const targetYear = year ? Number(year) : new Date().getFullYear();

    let balance = await LeaveBalance.findOne({ employee, year: targetYear });
    if (!balance) {
      balance = { paidDaysTotal: 24, unpaidDaysTotal: 0, sickDaysTotal: 0 };
    }

    const startOfYear = new Date(targetYear, 0, 1);
    const endOfYear = new Date(targetYear, 11, 31, 23, 59, 59);

    const entries = await LeaveEntry.find({
      employee,
      startDate: { $gte: startOfYear, $lte: endOfYear },
    });

    const used = { paid: 0, unpaid: 0, sick: 0 };
    entries.forEach((e) => {
      used[e.type] += e.daysCount;
    });

    res.json({
      year: targetYear,
      paid: { total: balance.paidDaysTotal, used: used.paid, remaining: balance.paidDaysTotal - used.paid },
      unpaid: {
        total: balance.unpaidDaysTotal,
        used: used.unpaid,
        remaining: balance.unpaidDaysTotal - used.unpaid,
      },
      sick: { total: balance.sickDaysTotal, used: used.sick, remaining: balance.sickDaysTotal - used.sick },
    });
  } catch (err) {
    console.error("getBalance failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function setBalance(req, res) {
  try {
    const { employee, year, paidDaysTotal, unpaidDaysTotal, sickDaysTotal } = req.body;
    if (!employee) return res.status(400).json({ error: "employee is required" });
    const targetYear = year || new Date().getFullYear();

    const balance = await LeaveBalance.findOneAndUpdate(
      { employee, year: targetYear },
      { paidDaysTotal, unpaidDaysTotal, sickDaysTotal },
      { upsert: true, new: true, runValidators: true }
    );

    res.json(balance);
  } catch (err) {
    console.error("setBalance failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getAllEntries(req, res) {
  try {
    const filter = {};
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.type) filter.type = req.query.type;
    if (req.query.from || req.query.to) {
      filter.startDate = {};
      if (req.query.from) filter.startDate.$gte = new Date(req.query.from);
      if (req.query.to) filter.startDate.$lte = new Date(req.query.to);
    }

    const entries = await LeaveEntry.find(filter)
      .populate("employee", "firstName lastName")
      .populate("createdBy", "firstName lastName")
      .sort({ startDate: -1 });
    res.json(entries);
  } catch (err) {
    console.error("getAllEntries failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function createEntry(req, res) {
  try {
    const { employee, type, startDate, endDate, note } = req.body;
    if (!employee || !type || !startDate || !endDate) {
      return res.status(400).json({ error: "employee, type, startDate, and endDate are required" });
    }
    if (!TYPE_TO_BALANCE_FIELD[type]) {
      return res.status(400).json({ error: "type must be one of: paid, unpaid, sick" });
    }

    const daysCount = await countChargeableDays(startDate, endDate);

    const year = new Date(startDate).getFullYear();
    const balance = await LeaveBalance.findOne({ employee, year });
    const total = balance?.[TYPE_TO_BALANCE_FIELD[type]] ?? (type === "paid" ? 24 : 0);

    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);
    const existing = await LeaveEntry.find({
      employee,
      type,
      startDate: { $gte: startOfYear, $lte: endOfYear },
    });
    const used = existing.reduce((sum, e) => sum + e.daysCount, 0);

    if (used + daysCount > total) {
      return res.status(400).json({
        error: `Not enough ${type} leave remaining (${total - used} days left, this request needs ${daysCount})`,
      });
    }

    const entry = await LeaveEntry.create({
      employee,
      type,
      startDate,
      endDate,
      daysCount,
      note,
      createdBy: req.employee._id,
    });

    const populated = await entry.populate("employee", "firstName lastName");
    res.status(201).json(populated);
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("createEntry failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteEntry(req, res) {
  try {
    const entry = await LeaveEntry.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteEntry failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getRestDays(req, res) {
  try {
    const filter = {};
    if (req.query.from || req.query.to) {
      filter.date = {};
      if (req.query.from) filter.date.$gte = new Date(req.query.from);
      if (req.query.to) filter.date.$lte = new Date(req.query.to);
    }
    const restDays = await RestDay.find(filter).sort({ date: 1 });
    res.json(restDays);
  } catch (err) {
    console.error("getRestDays failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function createRestDay(req, res) {
  try {
    const { date, label } = req.body;
    if (!date) return res.status(400).json({ error: "date is required" });

    const restDay = await RestDay.create({ date, label, createdBy: req.employee._id });
    res.status(201).json(restDay);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "This date is already marked as a rest day" });
    }
    console.error("createRestDay failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteRestDay(req, res) {
  try {
    const restDay = await RestDay.findByIdAndDelete(req.params.id);
    if (!restDay) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteRestDay failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
