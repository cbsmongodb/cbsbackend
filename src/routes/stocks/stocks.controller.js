import mongoose from "mongoose";
import ExcelJS from "exceljs";
import Drug from "../../models/Drug.js";
import DrugStock from "../../models/DrugStock.js";
import Employee from "../../models/Employee.js";

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const NAME_HINT = /name|დასახელ|პროდუქ|product|ნომენკლატ|საქონ|item|წამ|препарат|наимен|товар/i;
const QTY_HINT = /stock|მარაგ|ნაშთ|quantity|qty|რაოდ|balance|остат|колич|кол-во/i;
const TOTAL_ROW = /^(სულ|ჯამი|total|итого|всего)\b/i;

class UserError extends Error {}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/["'«»„“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// letters + digits only: "CEFZY 1000 №1,1g" == "Cefzy 1000 № 1, 1g"
const compact = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, "");
// punctuation -> spaces: "ACEFLEX_INJ N 1" -> "aceflex inj n 1"
const words = (s) => norm(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// "1 234", "1,234", "12,5", "1,234.50" -> numbers
function parseQty(v) {
  if (typeof v === "number") return v;
  let s = String(v ?? "").replace(/[\s\u00a0]/g, "");
  if (!s) return NaN;
  if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  return Number(s);
}

// ExcelJS cells can be plain values, formulas, rich text, hyperlinks...
function cellValue(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return v;
}

async function readSheet(base64) {
  const buf = Buffer.from(String(base64 || ""), "base64");
  // .xlsx is a zip file -> starts with "PK"
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new UserError("მხოლოდ .xlsx ფაილი მიიღება (Excel-ში: File → Save As → .xlsx)");
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
  } catch {
    throw new UserError("ფაილი ვერ წაიკითხა. შეამოწმეთ, რომ ნამდვილად .xlsx ფორმატშია");
  }
  for (const ws of wb.worksheets) {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let c = 1; c <= row.cellCount; c++) {
        const cell = row.getCell(c);
        // merged ranges (e.g. a manufacturer title over A:B) repeat the
        // master value in every cell -> keep it only in the first one
        const isCopy = cell.isMerged && cell.master && cell.master.address !== cell.address;
        vals.push(isCopy ? "" : cellValue(cell.value));
      }
      if (vals.some((v) => String(v).trim() !== "")) rows.push(vals);
    });
    if (rows.length >= 2) return { sheetName: ws.name, rows };
  }
  throw new UserError("ფაილში მონაცემები ვერ მოიძებნა");
}

// header = first row (within the first 15) that looks like column titles
function findHeaderRow(rows) {
  const limit = Math.min(rows.length - 1, 15);
  for (let i = 0; i < limit; i++) {
    const texts = rows[i].filter((v) => typeof v === "string" && v.trim() !== "");
    if (texts.length >= 2 && texts.some((v) => NAME_HINT.test(v) || QTY_HINT.test(v))) return i;
  }
  for (let i = 0; i < limit; i++) {
    if (rows[i].filter((v) => String(v).trim() !== "").length >= 2) return i;
  }
  return 0;
}

function guessColumns(headers, data) {
  let nameCol = headers.findIndex((h) => NAME_HINT.test(h));
  let qtyCol = headers.findIndex((h, i) => i !== nameCol && QTY_HINT.test(h));
  const sample = data.slice(0, 200);
  const score = (i, numeric) =>
    sample.filter((r) => {
      const v = r[i];
      if (v === "" || v === undefined || v === null) return false;
      return numeric ? Number.isFinite(parseQty(v)) : !Number.isFinite(parseQty(v));
    }).length;
  if (nameCol < 0) {
    let best = -1;
    headers.forEach((_, i) => {
      if (i === qtyCol) return;
      const s = score(i, false);
      if (s > best) { best = s; nameCol = i; }
    });
  }
  if (qtyCol < 0) {
    let best = -1;
    headers.forEach((_, i) => {
      if (i === nameCol) return;
      const s = score(i, true);
      if (s > best) { best = s; qtyCol = i; }
    });
  }
  return { nameCol: Math.max(nameCol, 0), qtyCol: Math.max(qtyCol, 0) };
}

// POST /api/stocks/preview  { fileBase64, period, nameCol?, qtyCol? }
// Reads the file and matches each line to a drug. Writes NOTHING.
export async function preview(req, res) {
  try {
    const { fileBase64, period } = req.body || {};
    if (!PERIOD_RE.test(period || "")) return res.status(400).json({ error: "აირჩიეთ თვე" });
    if (!fileBase64) return res.status(400).json({ error: "აირჩიეთ ფაილი" });

    const { sheetName, rows } = await readSheet(fileBase64);
    const headerIdx = findHeaderRow(rows);
    const width = Math.max(...rows.map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => {
      const h = String(rows[headerIdx][i] ?? "").trim();
      return h || `#${i + 1}`;
    });
    const data = rows.slice(headerIdx + 1);

    const guess = guessColumns(headers, data);
    const nameCol = Number.isInteger(req.body.nameCol) ? req.body.nameCol : guess.nameCol;
    const qtyCol = Number.isInteger(req.body.qtyCol) ? req.body.qtyCol : guess.qtyCol;
    if (nameCol < 0 || nameCol >= width || qtyCol < 0 || qtyCol >= width) {
      return res.status(400).json({ error: "არასწორი სვეტი" });
    }

    const drugs = await Drug.find({}).select("name stocks").sort({ name: 1 }).lean();
    const byCompact = new Map(drugs.map((d) => [compact(d.name), d]));
    const longestFirst = drugs
      .map((d) => ({ d, w: words(d.name) }))
      .filter((x) => x.w.length >= 3)
      .sort((a, b) => b.w.length - a.w.length);

    const lines = [];
    let skipped = 0;
    for (const r of data) {
      const fileName = String(r[nameCol] ?? "").trim();
      if (!fileName || TOTAL_ROW.test(fileName)) { skipped++; continue; }
      const rawQty = r[qtyCol];
      // an empty stock cell next to a drug name means nothing left -> 0
      const qty = rawQty === "" || rawQty === null || rawQty === undefined ? 0 : parseQty(rawQty);
      if (!Number.isFinite(qty)) { skipped++; continue; }

      let drug = byCompact.get(compact(fileName));
      let guessed = false;
      if (!drug) {
        // "ACEFLEX_INJ N 1" in the file -> "Aceflex" in the system
        const w = words(fileName);
        drug = longestFirst.find((x) => w.startsWith(x.w + " "))?.d;
        guessed = !!drug;
      }
      lines.push({ fileName, qty, drug: drug ? String(drug._id) : null, guessed });
    }

    res.json({
      sheetName,
      headers,
      nameCol,
      qtyCol,
      lines,
      skipped,
      drugs: drugs.map((d) => ({ _id: String(d._id), name: d.name, stocks: d.stocks || 0 })),
    });
  } catch (err) {
    if (err instanceof UserError) return res.status(400).json({ error: err.message });
    console.error("stocks preview failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/stocks/commit  { period, items: [{ drug, stocks, sourceName }] }
// The month's upload REPLACES any earlier upload of the same month.
// If it is the latest month, Drug.stocks is updated too.
export async function commit(req, res) {
  try {
    const { period, items } = req.body || {};
    if (!PERIOD_RE.test(period || "")) return res.status(400).json({ error: "აირჩიეთ თვე" });
    if (!Array.isArray(items) || items.length === 0 || items.length > 5000) {
      return res.status(400).json({ error: "შესანახი არაფერია" });
    }

    // same drug on several lines (e.g. batches) -> summed
    const totals = new Map();
    for (const it of items) {
      const id = String(it?.drug || "");
      const q = Number(it?.stocks);
      if (!mongoose.isValidObjectId(id) || !Number.isFinite(q)) continue;
      const cur = totals.get(id) || { stocks: 0, names: [] };
      cur.stocks += q;
      if (it.sourceName) cur.names.push(String(it.sourceName).slice(0, 200));
      totals.set(id, cur);
    }
    const existing = await Drug.find({ _id: { $in: [...totals.keys()] } }).select("_id");
    const valid = new Set(existing.map((d) => String(d._id)));
    const docs = [...totals]
      .filter(([id]) => valid.has(id))
      .map(([id, v]) => ({
        drug: id,
        period,
        stocks: v.stocks,
        sourceName: v.names.join(" | "),
        uploadedBy: req.employee?._id,
      }));
    if (docs.length === 0) return res.status(400).json({ error: "შესანახი არაფერია" });

    await DrugStock.deleteMany({ period });
    await DrugStock.insertMany(docs);

    const latest = await DrugStock.findOne({}).sort({ period: -1 }).select("period");
    const updatedCurrent = latest?.period === period;
    if (updatedCurrent) {
      await Drug.bulkWrite(
        docs.map((d) => ({ updateOne: { filter: { _id: d.drug }, update: { $set: { stocks: d.stocks } } } }))
      );
    }

    res.json({ saved: docs.length, period, updatedCurrent });
  } catch (err) {
    console.error("stocks commit failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/stocks/periods — one summary row per uploaded month, newest first
export async function listPeriods(req, res) {
  try {
    const agg = await DrugStock.aggregate([
      { $sort: { updatedAt: 1 } },
      {
        $group: {
          _id: "$period",
          count: { $sum: 1 },
          total: { $sum: "$stocks" },
          updatedAt: { $max: "$updatedAt" },
          uploadedBy: { $last: "$uploadedBy" },
        },
      },
      { $sort: { _id: -1 } },
    ]);
    const ids = agg.map((a) => a.uploadedBy).filter(Boolean);
    const people = await Employee.find({ _id: { $in: ids } }).select("firstName lastName");
    const names = new Map(people.map((p) => [String(p._id), `${p.firstName || ""} ${p.lastName || ""}`.trim()]));
    res.json(
      agg.map((a) => ({
        period: a._id,
        count: a.count,
        total: a.total,
        updatedAt: a.updatedAt,
        uploadedBy: a.uploadedBy ? names.get(String(a.uploadedBy)) || "" : "",
      }))
    );
  } catch (err) {
    console.error("stocks listPeriods failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/stocks/period/:period — the rows of one uploaded month
export async function getPeriod(req, res) {
  try {
    const { period } = req.params;
    if (!PERIOD_RE.test(period || "")) return res.status(400).json({ error: "არასწორი თვე" });
    const rows = await DrugStock.find({ period }).populate("drug", "name");
    res.json(
      rows
        .map((r) => ({ drug: r.drug?.name || "—", stocks: r.stocks, sourceName: r.sourceName || "" }))
        .sort((a, b) => a.drug.localeCompare(b.drug))
    );
  } catch (err) {
    console.error("stocks getPeriod failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
