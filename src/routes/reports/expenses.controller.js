// GET /api/reports/reimbursement/expenses
// The yearly travel-expenses workbook, exactly in the company's Expenses_YYYY.xlsx
// layout: one sheet per year, people down, months across, TOTAL row.
// Every finished month is filled automatically (once) before the file is built.
import ExcelJS from "exceljs";
import ExpenseRow from "../../models/ExpenseRow.js";
import ExpenseMonth from "../../models/ExpenseMonth.js";
import { MONTHS_EN, closeFinishedMonths, georgiaToday } from "../../utils/expenses.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";

const YELLOW = "FFFFFF00";   // regional reps
const GREY = "FFBFBFBF";     // left the company / TOTAL row
const GREEN = "FFD7E4BD";    // the newest month
const NUM = "0.00;[Red]0.00";
const thin = { style: "thin", color: { argb: "FF000000" } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const font = (size, bold = false) => ({ name: "Calibri", size, bold });
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

// columns: A spacer, B №, C name, D REG, E..P months
const WIDTHS = { A: 3.86, B: 5.71, C: 24.86, D: 11.29, E: 12.14, F: 13.57, G: 10.14, H: 8.43, I: 8.86, J: 9.57, K: 9.14, L: 10.86, M: 14.86, N: 12.14, O: 14.86, P: 14 };

function addYearSheet(wb, year, rows, newestMonth) {
  const ws = wb.addWorksheet(String(year), { properties: { defaultRowHeight: 15.75 } });
  Object.entries(WIDTHS).forEach(([c, w]) => { ws.getColumn(c).width = w; });

  const y = ws.getCell("C3");
  y.value = year;
  y.font = font(18, true);
  y.alignment = { horizontal: "left" };
  ws.getRow(3).height = 23.25;

  const h = ws.getRow(4);
  h.height = 18.75;
  const reg = h.getCell(4);
  reg.value = "REG";
  reg.font = font(12, true);
  reg.alignment = { horizontal: "center" };
  reg.border = BORDER;
  MONTHS_EN.forEach((m, i) => {
    const c = h.getCell(5 + i);
    c.value = m;
    c.font = font(14, true);
    c.numFmt = NUM;
    c.alignment = { horizontal: "center" };
    c.border = BORDER;
  });

  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.height = 15.75;
    const rowFill = r.left ? GREY : r.region ? YELLOW : null;

    const n = row.getCell(2);
    n.value = i + 1;
    n.font = font(12);
    n.alignment = { horizontal: "center" };
    n.border = BORDER;

    const name = row.getCell(3);
    name.value = r.name;
    name.font = font(12);
    name.alignment = { horizontal: "left" };
    name.border = BORDER;

    const rg = row.getCell(4);
    rg.value = r.region || null;
    rg.font = font(12);
    rg.alignment = { horizontal: "left" };
    rg.border = BORDER;

    for (let m = 0; m < 12; m++) {
      const c = row.getCell(5 + m);
      const v = r.amounts?.[m];
      c.value = v == null ? null : v;
      c.font = font(11);
      c.numFmt = NUM;
      c.alignment = { horizontal: "center" };
      c.border = BORDER;
      if (!r.left && newestMonth === m + 1) c.fill = fill(GREEN);
      else if (rowFill) c.fill = fill(rowFill);
    }
    if (rowFill) { name.fill = fill(rowFill); rg.fill = fill(rowFill); }
  });

  // TOTAL
  const tr = 5 + rows.length;
  const t = ws.getRow(tr);
  t.height = 15.75;
  const tn = t.getCell(2);
  tn.value = rows.length + 1;
  tn.font = font(12);
  tn.alignment = { horizontal: "center" };
  tn.border = BORDER;
  const tl = t.getCell(3);
  tl.value = "TOTAL";
  tl.font = font(12, true);
  tl.fill = fill(GREY);
  tl.border = BORDER;
  for (let m = 0; m < 12; m++) {
    const c = t.getCell(5 + m);
    const L = ws.getColumn(5 + m).letter;
    const sum = rows.reduce((s, r) => s + (Number(r.amounts?.[m]) || 0), 0);
    c.value = rows.length ? { formula: `SUM(${L}5:${L}${tr - 1})`, result: Math.round(sum * 100) / 100 } : 0;
    c.font = font(12, true);
    c.numFmt = NUM;
    c.alignment = { horizontal: "center" };
    c.fill = fill(GREY);
    c.border = BORDER;
  }
  return ws;
}

export async function exportExpensesWorkbook(req, res) {
  try {
    await closeFinishedMonths();

    const scope = await getScopeEmployeeIds(req.employee);
    const scopeSet = scope ? new Set(scope.map(String)) : null;

    const [rows, months] = await Promise.all([
      ExpenseRow.find({}).sort({ year: 1, order: 1 }).lean(),
      ExpenseMonth.find({}).lean(),
    ]);
    const byYear = new Map();
    rows.forEach((r) => {
      if (scopeSet && !(r.employee && scopeSet.has(String(r.employee)))) return;
      if (!byYear.has(r.year)) byYear.set(r.year, []);
      byYear.get(r.year).push(r);
    });
    const { year: cy } = georgiaToday();
    if (!byYear.size) return res.status(404).json({ error: "No expenses data yet — run src/scripts/importExpenses.js first" });

    // newest finished month -> green column (in that year's sheet)
    const newest = months.reduce((a, m) => (!a || m.year * 12 + m.month > a.year * 12 + a.month ? m : a), null);

    const wb = new ExcelJS.Workbook();
    wb.creator = "Global CBS";
    wb.created = new Date();
    const years = [...byYear.keys()].sort((a, b) => a - b);
    years.forEach((y) => addYearSheet(wb, y, byYear.get(y), newest && newest.year === y ? newest.month : null));
    wb.views = [{ activeTab: Math.max(0, years.indexOf(cy) >= 0 ? years.indexOf(cy) : years.length - 1) }];

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Expenses_${years[years.length - 1]}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportExpensesWorkbook failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
