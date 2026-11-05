// GET /api/reports/reimbursement/expenses?from=YYYY-MM-DD&to=YYYY-MM-DD[&employee=][&division=]
// Travel expenses for the dates chosen on the Reimbursement page, in the company's
// Expenses_YYYY.xlsx look: №, name, REG, amount, TOTAL (regional reps yellow).
// Same filters and the same calculation as the report on screen
// (one hospital visit day = the region's amount). Nothing is saved.
import ExcelJS from "exceljs";
import PlanConfiguration from "../../models/PlanConfiguration.js";
import ExpenseRow from "../../models/ExpenseRow.js";
import Employee from "../../models/Employee.js";
import "../../models/Hospital.js";
import "../../models/Region.js";
import { MONTHS_EN } from "../../utils/expenses.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";
import { divisionEmployeeIds } from "./reports.controller.js";

const YELLOW = "FFFFFF00";   // regional reps
const GREY = "FFBFBFBF";     // TOTAL row
const GREEN = "FFD7E4BD";    // the amount column
const NUM = "0.00;[Red]0.00";
const thin = { style: "thin", color: { argb: "FF000000" } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const font = (size, bold = false) => ({ name: "Calibri", size, bold });
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
const dayStart = (s) => new Date(`${s}T00:00:00+04:00`);
const dayEnd = (s) => new Date(`${s}T23:59:59.999+04:00`);
const ddmm = (s) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;

// "2026-10-01".."2026-10-31" -> "OCTOBER"; anything else -> "30.10.2026 – 05.11.2026"
function periodLabel(from, to) {
  const lastDay = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7), 0)).getUTCDate();
  if (from.slice(0, 7) === to.slice(0, 7) && from.slice(8) === "01" && +to.slice(8) === lastDay) {
    return MONTHS_EN[+from.slice(5, 7) - 1];
  }
  return from === to ? ddmm(from) : `${ddmm(from)} – ${ddmm(to)}`;
}

function buildSheet(wb, year, label, rows) {
  const ws = wb.addWorksheet(label.replace(/[\\/?*[\]:]/g, " ").slice(0, 31), { properties: { defaultRowHeight: 15.75 } });
  [["A", 3.86], ["B", 5.71], ["C", 26], ["D", 12], ["E", Math.max(15, label.length + 4)]].forEach(([c, w]) => { ws.getColumn(c).width = w; });

  const y = ws.getCell("C3");
  y.value = year;
  y.font = font(18, true);
  y.alignment = { horizontal: "left" };
  ws.getRow(3).height = 23.25;

  const h = ws.getRow(4);
  h.height = 18.75;
  [[4, "REG", 12], [5, label, 14]].forEach(([col, v, size]) => {
    const c = h.getCell(col);
    c.value = v;
    c.font = font(size, true);
    c.alignment = { horizontal: "center" };
    c.border = BORDER;
  });

  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.height = 15.75;
    [[2, i + 1, 12, "center"], [3, r.name, 12, "left"], [4, r.region || null, 12, "left"], [5, r.amount, 11, "center"]]
      .forEach(([col, value, size, align]) => {
        const c = row.getCell(col);
        c.value = value;
        c.font = font(size);
        c.alignment = { horizontal: align };
        c.border = BORDER;
        if (col === 5) { c.numFmt = NUM; c.fill = fill(GREEN); }
        else if (col > 2 && r.region) c.fill = fill(YELLOW);
      });
  });

  const tr = 5 + rows.length;
  const t = ws.getRow(tr);
  t.height = 15.75;
  const tl = t.getCell(3);
  tl.value = "TOTAL";
  tl.font = font(12, true);
  tl.fill = fill(GREY);
  tl.border = BORDER;
  const sum = Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
  const tc = t.getCell(5);
  tc.value = rows.length ? { formula: `SUM(E5:E${tr - 1})`, result: sum } : 0;
  tc.font = font(12, true);
  tc.numFmt = NUM;
  tc.alignment = { horizontal: "center" };
  tc.fill = fill(GREY);
  tc.border = BORDER;
}

export async function exportExpensesWorkbook(req, res) {
  try {
    const { from, to, employee, division } = req.query;
    if (!isDay(from) || !isDay(to) || from > to) return res.status(400).json({ error: "from / to dates are required" });

    // the same filter as the Reimbursement report on screen
    const filter = { status: { $in: ["i_went", "i_left", "completed"] }, hospital: { $ne: null }, period: { $gte: dayStart(from), $lte: dayEnd(to) } };
    let ids = null; // null = everyone
    const scope = await getScopeEmployeeIds(req.employee);
    if (scope) ids = scope.map(String);
    if (employee) ids = ids ? ids.filter((x) => x === String(employee)) : [String(employee)];
    if (division) {
      const d = new Set(await divisionEmployeeIds(division));
      ids = ids ? ids.filter((x) => d.has(x)) : [...d];
    }
    if (ids) filter.performer = { $in: ids };

    const plans = await PlanConfiguration.find(filter)
      .populate({ path: "hospital", select: "region", populate: { path: "region", select: "reimbursementAmt" } })
      .select("period performer hospital")
      .sort({ iWentAt: 1 })
      .lean();
    const seen = new Set();
    const sums = new Map();
    for (const p of plans) {
      if (!p.hospital?.region || !p.performer) continue;
      const emp = String(p.performer);
      const key = `${new Date(p.period).toISOString().slice(0, 10)}_${emp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sums.set(emp, (sums.get(emp) || 0) + (p.hospital.region.reimbursementAmt || 0));
    }

    // names, REG and order as in the Expenses workbook of that year
    const year = +to.slice(0, 4);
    let list = await ExpenseRow.find({ year }).sort({ order: 1 }).lean();
    if (!list.length) {
      const last = await ExpenseRow.findOne({}).sort({ year: -1 }).select("year").lean();
      if (last) list = await ExpenseRow.find({ year: last.year }).sort({ order: 1 }).lean();
    }
    const rows = [];
    const done = new Set();
    for (const r of list) {
      const id = r.employee ? String(r.employee) : null;
      if (!id || !sums.has(id) || done.has(id)) continue;
      done.add(id);
      rows.push({ name: r.name, region: r.region, amount: Math.round(sums.get(id) * 100) / 100 });
    }
    const rest = [...sums.keys()].filter((id) => !done.has(id));
    if (rest.length) {
      const emps = await Employee.find({ _id: { $in: rest } }).select("firstName lastName").lean();
      emps
        .map((e) => ({ name: `${e.firstName || ""} ${e.lastName || ""}`.trim().toUpperCase(), region: "", amount: Math.round(sums.get(String(e._id)) * 100) / 100 }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((r) => rows.push(r));
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = "Global CBS";
    wb.created = new Date();
    buildSheet(wb, year, periodLabel(from, to), rows);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Expenses_${from}_${to}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportExpensesWorkbook failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
