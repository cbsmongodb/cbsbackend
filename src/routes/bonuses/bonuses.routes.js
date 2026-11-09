// Bonuses page: bonus per box for every drug, month by month, plus
// doctor-specific bonuses. Mounted behind requirePermission("drug_bonuses").
import express from "express";
import mongoose from "mongoose";
import Drug from "../../models/Drug.js";
import DrugBonus from "../../models/DrugBonus.js";
import DoctorDrugBonus from "../../models/DoctorDrugBonus.js";
import Doctor from "../../models/Doctor.js";
import "../../models/Profile.js";
import {
  parseMonth, monthStart, monthWindow, monthLabel, hasDefault, DEFAULT_BONUS, restampBonuses,
} from "../../utils/bonuses.js";

const router = express.Router();
const isId = (x) => mongoose.isValidObjectId(x);
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const monthOr400 = (req, res) => {
  const m = parseMonth(req.query.month || req.body?.month);
  if (!m) res.status(400).json({ error: "month is required (YYYY-MM)" });
  return m;
};

// GET /api/bonuses?month=2026-10
// every active drug with its bonus for the month (or what it inherits) and its doctor bonuses
router.get("/", async (req, res) => {
  try {
    const month = monthOr400(req, res);
    if (!month) return;
    const [drugs, monthly, overrides] = await Promise.all([
      Drug.find({ isActive: { $ne: false } }).select("name price bonus").sort({ name: 1 }).lean(),
      DrugBonus.find({ period: monthWindow(month) }).select("drug value").lean(),
      DoctorDrugBonus.find({ period: monthWindow(month) })
        .select("doctor drug value")
        .populate({ path: "doctor", select: "firstName lastName uniqueNumber profile", populate: { path: "profile", select: "name" } })
        .lean(),
    ]);
    const monthValue = new Map(monthly.map((b) => [String(b.drug), b]));
    const byDrug = new Map();
    overrides.forEach((o) => {
      const k = String(o.drug);
      if (!byDrug.has(k)) byDrug.set(k, []);
      byDrug.get(k).push(o);
    });
    res.json({
      month: monthLabel(month),
      defaultBonus: hasDefault(month) ? DEFAULT_BONUS : null,
      drugs: drugs.map((d) => {
        const own = monthValue.get(String(d._id));
        const inherited = d.bonus > 0 ? d.bonus : hasDefault(month) ? DEFAULT_BONUS : 0;
        return {
          _id: d._id,
          name: d.name,
          price: d.price || 0,
          value: own ? own.value : null, // set for this month
          inherited, // used when value is empty
          inheritedFrom: d.bonus > 0 ? "drug" : hasDefault(month) ? "default" : "none",
          doctors: (byDrug.get(String(d._id)) || [])
            .filter((o) => o.doctor)
            .map((o) => ({ _id: o._id, value: o.value, doctor: o.doctor }))
            .sort((a, b) => `${a.doctor.firstName} ${a.doctor.lastName}`.localeCompare(`${b.doctor.firstName} ${b.doctor.lastName}`)),
        };
      }),
    });
  } catch (err) {
    console.error("get bonuses failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/bonuses/drug  { month, drug, value }   value empty -> back to the inherited one
router.put("/drug", async (req, res) => {
  try {
    const month = monthOr400(req, res);
    if (!month) return;
    const { drug } = req.body;
    const value = num(req.body.value);
    if (!isId(drug)) return res.status(400).json({ error: "drug is required" });
    if (Number.isNaN(value)) return res.status(400).json({ error: "ბონუსი უნდა იყოს 0 ან მეტი რიცხვი" });
    if (value === null) {
      await DrugBonus.deleteOne({ drug, period: monthWindow(month) });
    } else {
      // remove any older record of this month saved at another hour, then write one clean record
      await DrugBonus.deleteMany({ drug, period: monthWindow(month), $nor: [{ period: monthStart(month) }] });
      await DrugBonus.findOneAndUpdate(
        { drug, period: monthStart(month) },
        { $set: { value, setBy: req.employee?._id } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }
    const r = await restampBonuses(month, { drug });
    res.json({ ok: true, recalculated: r.changed });
  } catch (err) {
    console.error("save drug bonus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/bonuses/doctor  { month, drug, doctor, value }   value empty -> delete
router.put("/doctor", async (req, res) => {
  try {
    const month = monthOr400(req, res);
    if (!month) return;
    const { drug, doctor } = req.body;
    const value = num(req.body.value);
    if (!isId(drug) || !isId(doctor)) return res.status(400).json({ error: "drug and doctor are required" });
    if (Number.isNaN(value)) return res.status(400).json({ error: "ბონუსი უნდა იყოს 0 ან მეტი რიცხვი" });
    if (value === null) {
      await DoctorDrugBonus.deleteMany({ drug, doctor, period: monthWindow(month) });
    } else {
      await DoctorDrugBonus.findOneAndUpdate(
        { drug, doctor, period: monthStart(month) },
        { $set: { value, setBy: req.employee?._id } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }
    const r = await restampBonuses(month, { drug, doctor });
    res.json({ ok: true, recalculated: r.changed });
  } catch (err) {
    console.error("save doctor bonus failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/bonuses/copy  { from: "2026-10", to: "2026-11" }
// copies every bonus that is set in "from" and NOT set yet in "to" (nothing is overwritten)
router.post("/copy", async (req, res) => {
  try {
    const from = parseMonth(req.body.from);
    const to = parseMonth(req.body.to);
    if (!from || !to) return res.status(400).json({ error: "from and to are required (YYYY-MM)" });
    const [srcDrug, dstDrug, srcDoc, dstDoc] = await Promise.all([
      DrugBonus.find({ period: monthWindow(from) }).select("drug value").lean(),
      DrugBonus.find({ period: monthWindow(to) }).select("drug").lean(),
      DoctorDrugBonus.find({ period: monthWindow(from) }).select("drug doctor value").lean(),
      DoctorDrugBonus.find({ period: monthWindow(to) }).select("drug doctor").lean(),
    ]);
    const haveDrug = new Set(dstDrug.map((b) => String(b.drug)));
    const haveDoc = new Set(dstDoc.map((b) => `${b.doctor}|${b.drug}`));
    const newDrug = srcDrug.filter((b) => !haveDrug.has(String(b.drug)));
    const newDoc = srcDoc.filter((b) => !haveDoc.has(`${b.doctor}|${b.drug}`));
    if (newDrug.length) {
      await DrugBonus.insertMany(newDrug.map((b) => ({ drug: b.drug, period: monthStart(to), value: b.value, setBy: req.employee?._id })), { ordered: false });
    }
    if (newDoc.length) {
      await DoctorDrugBonus.insertMany(newDoc.map((b) => ({ drug: b.drug, doctor: b.doctor, period: monthStart(to), value: b.value, setBy: req.employee?._id })), { ordered: false });
    }
    const r = await restampBonuses(to);
    res.json({ ok: true, copiedDrugs: newDrug.length, copiedDoctors: newDoc.length, recalculated: r.changed });
  } catch (err) {
    console.error("copy bonuses failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET /api/bonuses/doctor-search?q=   (small list for the "add a doctor" picker)
router.get("/doctor-search", async (req, res) => {
  try {
    const { nameSearchFilter } = await import("../../utils/nameSearch.js");
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json([]);
    const docs = await Doctor.find(nameSearchFilter(q, ["firstName", "lastName", "uniqueNumber"]))
      .select("firstName lastName uniqueNumber profile").populate("profile", "name").limit(30).lean();
    res.json(docs);
  } catch (err) {
    console.error("doctor-search failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
