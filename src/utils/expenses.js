// Travel-expenses workbook (Expenses_YYYY.xlsx): monthly amounts per person,
// computed exactly like the Reimbursement report — one hospital visit day =
// the region's reimbursement amount (only one per person per day).
import PlanConfiguration from "../models/PlanConfiguration.js";
import "../models/Hospital.js"; // populate(hospital -> region) also works in scripts
import "../models/Region.js";
import Employee from "../models/Employee.js";
import ExpenseRow from "../models/ExpenseRow.js";
import ExpenseMonth from "../models/ExpenseMonth.js";

export const MONTHS_EN = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

const pad = (n) => String(n).padStart(2, "0");

// today in Georgia → { year, month }
export function georgiaToday() {
  const s = new Date(Date.now() + 4 * 3600e3).toISOString();
  return { year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) };
}

// { employeeId(string) -> amount } for one month
export async function computeMonthAmounts(year, month) {
  const from = new Date(`${year}-${pad(month)}-01T00:00:00+04:00`);
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const to = new Date(+new Date(`${ny}-${pad(nm)}-01T00:00:00+04:00`) - 1);

  const plans = await PlanConfiguration.find({
    status: { $in: ["i_went", "i_left", "completed"] },
    hospital: { $ne: null },
    period: { $gte: from, $lte: to },
  })
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
  for (const [k, v] of sums) sums.set(k, Math.round(v * 100) / 100);
  return sums;
}

// a year without rows gets the previous year's people (not the ones who left), empty months
export async function ensureYear(year) {
  if (await ExpenseRow.exists({ year })) return;
  const prev = await ExpenseRow.find({ year: year - 1, left: { $ne: true } }).sort({ order: 1 }).lean();
  if (!prev.length) return;
  await ExpenseRow.insertMany(prev.map((r, i) => ({
    year, order: i + 1, name: r.name, region: r.region, employee: r.employee, left: false, amounts: Array(12).fill(null),
  })));
}

// fill one finished month from the CRM (only empty cells), add new people at the end
export async function fillMonthFromCrm(year, month) {
  const sums = await computeMonthAmounts(year, month);
  const rows = await ExpenseRow.find({ year }).sort({ order: 1 });
  const byEmp = new Map(rows.filter((r) => r.employee).map((r) => [String(r.employee), r]));
  let order = rows.reduce((m, r) => Math.max(m, r.order || 0), 0);

  const newIds = [...sums.keys()].filter((id) => !byEmp.has(id));
  const newEmps = newIds.length
    ? await Employee.find({ _id: { $in: newIds } }).select("firstName lastName").lean()
    : [];
  const nameOf = new Map(newEmps.map((e) => [String(e._id), `${e.firstName || ""} ${e.lastName || ""}`.trim().toUpperCase()]));

  for (const [empId, amount] of sums) {
    const row = byEmp.get(empId);
    if (row) {
      if (row.amounts[month - 1] == null) {
        row.amounts.set(month - 1, amount);
        await row.save();
      }
    } else {
      const amounts = Array(12).fill(null);
      amounts[month - 1] = amount;
      await ExpenseRow.create({ year, order: ++order, name: nameOf.get(empId) || "?", employee: empId, amounts });
    }
  }
  return sums.size;
}

// every finished month that is not filled yet gets filled — once
export async function closeFinishedMonths() {
  const { year: cy, month: cm } = georgiaToday();
  const first = await ExpenseRow.findOne({}).sort({ year: 1 }).select("year").lean();
  if (!first) return [];
  for (let y = first.year; y <= cy; y++) await ensureYear(y);

  const closed = new Set((await ExpenseMonth.find({}).lean()).map((m) => `${m.year}-${m.month}`));
  const done = [];
  for (let y = first.year; y <= cy; y++) {
    const last = y < cy ? 12 : cm - 1;
    for (let m = 1; m <= last; m++) {
      if (closed.has(`${y}-${m}`)) continue;
      try {
        await ExpenseMonth.create({ year: y, month: m, source: "crm" }); // lock (unique) before filling
      } catch (e) {
        if (e.code === 11000) continue; // someone else is filling it right now
        throw e;
      }
      await fillMonthFromCrm(y, m);
      done.push(`${y}-${pad(m)}`);
    }
  }
  return done;
}

// --- name matching (Excel spelling vs CRM spelling) ---
const norm = (s) => String(s || "").toUpperCase().replace(/^MR\.?\s*/, "").replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
export function looseName(s) {
  return norm(s)
    .replace(/PH/g, "P").replace(/TH/g, "T").replace(/KH/g, "K").replace(/GH/g, "G").replace(/ZH/g, "J")
    .replace(/SH/g, "S").replace(/TCH/g, "C").replace(/CH/g, "C").replace(/TC/g, "C").replace(/TS/g, "C").replace(/DZ/g, "Z").replace(/DJ/g, "J")
    .replace(/W/g, "C").replace(/X/g, "K").replace(/Q/g, "K").replace(/Y/g, "I")
    .replace(/(.)\1+/g, "$1");
}

// rows: [{ name }] -> Map(name -> { employee, how }) ; employees: [{ _id, firstName, lastName }]
export function matchNames(names, employees) {
  const full = new Map();
  const last = new Map();
  const push = (map, k, e) => { if (!map.has(k)) map.set(k, []); if (!map.get(k).includes(e)) map.get(k).push(e); };
  for (const e of employees) {
    push(full, looseName(`${e.firstName} ${e.lastName}`), e);
    push(full, looseName(`${e.lastName} ${e.firstName}`), e);
    if (e.lastName) push(last, looseName(e.lastName), e);
  }
  const out = new Map();
  for (const n of names) {
    const byFull = full.get(looseName(n)) || [];
    if (byFull.length === 1) { out.set(n, { employee: byFull[0], how: "name" }); continue; }
    const parts = norm(n).split(" ");
    const byLast = last.get(looseName(parts[parts.length - 1])) || [];
    if (byLast.length === 1) { out.set(n, { employee: byLast[0], how: "surname" }); continue; }
    // same surname twice -> the one whose first name starts the same way
    const f3 = looseName(parts[0]).slice(0, 3);
    const byFirst = byLast.filter((e) => looseName(e.firstName).slice(0, 3) === f3);
    if (byFirst.length === 1) { out.set(n, { employee: byFirst[0], how: "surname" }); continue; }
    out.set(n, { employee: null, how: byLast.length > 1 ? `${byLast.length} same surname` : "not found" });
  }
  return out;
}
