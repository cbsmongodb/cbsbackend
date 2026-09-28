import DrugBonus from "../../models/DrugBonus.js";

// თვის დასაწყისზე ნორმალიზება (2026-08-15 -> 2026-08-01)
function normalizeToMonthStart(dateLike) {
  const d = new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

// GET /api/drug-bonuses?drug=<id> — ერთი წამლის ყველა თვის ბონუსი
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

// POST /api/drug-bonuses — დამატება ან განახლება (upsert) თვეზე
// body: { drug, period, value }
export async function upsertBonus(req, res) {
  try {
    const { drug, period, value } = req.body;
    if (!drug || !period || value === undefined) {
      return res.status(400).json({ error: "drug, period, and value are required" });
    }

    const periodDate = normalizeToMonthStart(period);

    const item = await DrugBonus.findOneAndUpdate(
      { drug, period: periodDate },
      { drug, period: periodDate, value, setBy: req.employee?._id },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json(item);
  } catch (err) {
    console.error("upsertBonus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// DELETE /api/drug-bonuses/:id — ერთი თვის ბონუსის წაშლა
export async function deleteBonus(req, res) {
  try {
    await DrugBonus.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteBonus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
