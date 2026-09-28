import DrugBonus from "../../models/DrugBonus.js";

function normalizeToMonthStart(dateLike) {
  const d = new Date(dateLike);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function listByDrug(req, res) {
  try {
    const { drug } = req.query;
    if (!drug) return res.status(400).json({ error: "drug is required" });
    const items = await DrugBonus.find({ drug }).sort({ period: 1 });
    res.json(items);
  } catch (err) {
    console.error("listByDrug failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function upsertBonus(req, res) {
  try {
    const { drug, period, value } = req.body;
    if (!drug || period === undefined || value === undefined) {
      return res.status(400).json({ error: "drug, period, and value are required" });
    }

    const periodDate = normalizeToMonthStart(period);
    if (!periodDate) {
      return res.status(400).json({ error: "invalid period" });
    }

    const numValue = Number(value);
    if (isNaN(numValue)) {
      return res.status(400).json({ error: "value must be a number" });
    }

    const update = { drug, period: periodDate, value: numValue };
    if (req.employee?._id) update.setBy = req.employee._id;

    const item = await DrugBonus.findOneAndUpdate(
      { drug, period: periodDate },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json(item);
  } catch (err) {
    console.error("upsertBonus failed:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
}

export async function deleteBonus(req, res) {
  try {
    await DrugBonus.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteBonus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
