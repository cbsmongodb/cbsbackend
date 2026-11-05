// GET /api/reports/reimbursement/expenses?month=YYYY-MM
// Travel expenses of ONE month, in the company's Expenses_YYYY.xlsx look:
// №, name, REG, the month's amount, TOTAL (regional reps yellow).
// A finished month is filled from the CRM once and saved (old months come from
// the imported Excel); the current month is shown live and not saved.
import ExcelJS from "exceljs";
import ExpenseRow from "../../models/ExpenseRow.js";
import Employee from "../../models/Employee.js";
import { MONTHS_EN, closeFinishedMonths, computeMonthAmounts, georgiaToday } from "../../utils/expenses.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";

const YELLOW = "FFFFFF00";   // regional reps
const GREY = "FFBFBFBF";     // TOTAL row
const GREEN = "FFD7E4BD";    // the month column
const NUM = "0.00;[Red]0.00";
const thin = { style: "thin", color: { argb: "FF000000" } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const font = (size, bold = false) => ({ name: "Calibri", size, bold });
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

function buildMonthSheet(wb, year, month, rows) {
  const ws = wb.addWorksheet(`${MONTHS_EN[month - 1]} ${year}`, { properties: { defaultRowHeight: 15.75 } });
  [["A", 3.86], ["B", 5.71], ["C", 26], ["D", 12], ["E", 15]].forEach(([c, w]) => { ws.getColumn(c).width = w; });

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
  const mh = h.getCell(5);
  mh.value = MONTHS_EN[month - 1];
  mh.font = font(14, true);
  mh.alignment = { horizontal: "center" };
  mh.border = BORDER;

  rows.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.height = 15.75;
    const yellow = r.region ? fill(YELLOW) : null;
    const cells = [
      [2, i + 1, font(12), "center"],
      [3, r.name, font(12), "left"],
      [4, r.region || null, font(12), "left"],
      [5, r.amount, font(11), "center"],
    ];
    cells.forEach(([col, value, f, align]) => {
      const c = row.getCell(col);
      c.value = value;
      c.font = f;
      c.alignment = { horizontal: align };
      c.border = BORDER;
      if (col === 5) { c.numFmt = NUM; c.fill = fill(GREEN); }
      else if (col > 2 && yellow) c.fill = yellow;
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
    await closeFinishedMonths(); // saves every finished month once (keeps the yearly history complete)

    const today = georgiaToday();
    let year, month;
    const q = String(req.query.month || "").match(/^(\d{4})-(\d{2})$/);
    if (q) { year = +q[1]; month = +q[2]; }
    else if (today.month === 1) { year = today.year - 1; month = 12; } // default: last finished month
    else { year = today.year; month = today.month - 1; }
    if (month < 1 || month > 12) return res.status(400).json({ error: "month=YYYY-MM" });

    const isFuture = year > today.year || (year === today.year && month > today.month);
    if (isFuture) return res.status(400).json({ error: "This month has not started yet" });
    const isCurrent = year === today.year && month === today.month;

    const stored = await ExpenseRow.find({ year }).sort({ order: 1 }).lean();
    let rows;
    if (!isCurrent) {
      rows = stored.map((r) => ({ ...r, amount: r.amounts?.[month - 1] ?? null }));
    } else {
      // running month: live numbers from the CRM, nothing saved
      const live = await computeMonthAmounts(year, month);
      const byEmp = new Map(stored.filter((r) => r.employee).map((r) => [String(r.employee), r]));
      rows = stored.map((r) => ({ ...r, amount: r.employee ? live.get(String(r.employee)) ?? null : null }));
      const extra = [...live.keys()].filter((id) => !byEmp.has(id));
      if (extra.length) {
        const emps = await Employee.find({ _id: { $in: extra } }).select("firstName lastName").lean();
        emps.forEach((e) => rows.push({
          name: `${e.firstName || ""} ${e.lastName || ""}`.trim().toUpperCase(), region: "", employee: e._id, amount: live.get(String(e._id)),
        }));
      }
    }

    const scope = await getScopeEmployeeIds(req.employee);
    const scopeSet = scope ? new Set(scope.map(String)) : null;
    rows = rows.filter((r) => r.amount != null && (!scopeSet || (r.employee && scopeSet.has(String(r.employee)))));

    const wb = new ExcelJS.Workbook();
    wb.creator = "Global CBS";
    wb.created = new Date();
    buildMonthSheet(wb, year, month, rows);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="Expenses_${year}-${String(month).padStart(2, "0")}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("exportExpensesWorkbook failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
