import DoctorEntryItem from "../../models/DoctorEntryItem.js";

// Temporary basic CRUD so the server boots — the real submission flow
// (coefficient/total_budget calculation, DoctorEntrySummary rollup,
// role-based drug/doctor scoping) still needs to be built out.
// This file will be replaced in the next pass.

const POPULATE = "employee doctor drug hospital";

export async function getAllSalesEntries(req, res) {
  try {
    const filter = {};
    if (req.query.employee) filter.employee = req.query.employee;
    if (req.query.doctor) filter.doctor = req.query.doctor;
    if (req.query.period) filter.period = new Date(req.query.period);

    const entries = await DoctorEntryItem.find(filter).populate(POPULATE).sort({ period: -1 });
    res.json(entries);
  } catch (err) {
    console.error("getAllSalesEntries failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function createSalesEntry(req, res) {
  try {
    const entry = await DoctorEntryItem.create(req.body);
    const populated = await entry.populate(POPULATE);
    res.status(201).json(populated);
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("createSalesEntry failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateSalesEntry(req, res) {
  try {
    const entry = await DoctorEntryItem.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate(POPULATE);
    if (!entry) return res.status(404).json({ error: "Sales entry not found" });
    res.json(entry);
  } catch (err) {
    console.error("updateSalesEntry failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteSalesEntry(req, res) {
  try {
    const entry = await DoctorEntryItem.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ error: "Sales entry not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteSalesEntry failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
