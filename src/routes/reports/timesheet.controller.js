import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";
import TimesheetSheet from "../../models/TimesheetSheet.js";
import TimesheetMember from "../../models/TimesheetMember.js";
import TimesheetCell from "../../models/TimesheetCell.js";
import LeaveEntry from "../../models/LeaveEntry.js";
import RestDay from "../../models/RestDay.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";
import Section from "../../models/Section.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";
import { createCache } from "../../utils/cacheBus.js";
import { georgianHolidays } from "../../utils/georgianHolidays.js";
import { buildTimesheetXlsx, MONTHS_KA, FORM_CAPACITY } from "../../utils/timesheetXlsx.js";

// Timesheet (ტაბელი) report: every official timesheet filled in automatically
// (working day = hours, weekend / public holiday = "დ", approved leave =
// "ა/შ" / "უხ/შ" / "ს/ფ"), any day can be changed by hand, and the month is
// downloaded in the company's own Excel form.

const TEMPLATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../templates/timesheet-master.xlsx");
let templateBuffer = null;
const template = () => (templateBuffer ||= fs.readFileSync(TEMPLATE_PATH));

export const CODES = ["დ", "ა/შ", "უხ/შ", "ს/ფ", "გ", "დ/შ"];
const LEAVE_CODE = { paid: "ა/შ", unpaid: "უხ/შ", sick: "ს/ფ" };
const pad = (n) => String(n).padStart(2, "0");
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const isValue = (v) => CODES.includes(v) || /^\d{1,2}(\.\d{1,2})?$/.test(v);

function parseMonth(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  return m ? { year: +m[1], month: +m[2] } : { year: now.getFullYear(), month: now.getMonth() + 1 };
}

// which timesheets this person may see: everything for director / finance /
// office; a division manager only the timesheets of his own division.
// Cached for a minute (and dropped at once when employees / groups / divisions change).
const scopeCache = createCache(60_000);
async function allowedSheetFilter(emp) {
  const scope = await getScopeEmployeeIds(emp);
  if (!scope) return {};
  const sectionIds = await scopeCache(String(emp._id), async () => {
    const groupIds = await Employee.find({ _id: { $in: scope } }).distinct("group");
    const [fromGroups, headed] = await Promise.all([
      Group.find({ _id: { $in: groupIds } }).distinct("section"),
      Section.find({ head: emp._id }).distinct("_id"),
    ]);
    return [...fromGroups, ...headed].filter(Boolean);
  });
  return { section: { $in: sectionIds } };
}
async function loadSheet(req, key) {
  const sheet = await TimesheetSheet.findOne({ key, ...(await allowedSheetFilter(req.employee)) }).lean();
  return sheet;
}

function leaveDays(entry) {
  if (entry.days?.length) return entry.days.map((d) => ({ date: dayKey(d.date), type: d.type }));
  const out = [];
  if (!LEAVE_CODE[entry.type]) return out;
  for (let d = new Date(dayKey(entry.startDate)); d <= new Date(dayKey(entry.endDate)); d = new Date(d.getTime() + 86400000)) {
    out.push({ date: dayKey(d), type: entry.type });
  }
  return out;
}

async function restDaysBetween(from, to) {
  const rows = await RestDay.find({ date: { $gte: new Date(from.getTime() - 86400000), $lte: new Date(to.getTime() + 86400000) } }).select("date").lean();
  return new Set(rows.map((r) => dayKey(new Date(r.date.getTime() + 12 * 3600e3))));
}

const holidayCache = new Map();
const holidaysOf = (y) => (holidayCache.has(y) ? holidayCache.get(y) : holidayCache.set(y, georgianHolidays(y)).get(y));

function monthDays(year, month, restDays) {
  const holidays = holidaysOf(year);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => {
    const key = `${year}-${pad(month)}-${pad(i + 1)}`;
    const wd = new Date(Date.UTC(year, month - 1, i + 1)).getUTCDay();
    const holiday = holidays.has(key) || restDays.has(key);
    return { day: i + 1, key, wd, weekend: wd === 0 || wd === 6, holiday };
  });
}

// first working day of the next month — the usual "document date"
function defaultDocDate(year, month, restDays) {
  const ny = month === 12 ? year + 1 : year, nm = month === 12 ? 1 : month + 1;
  const days = monthDays(ny, nm, restDays);
  const d = days.find((x) => !x.weekend && !x.holiday) || days[0];
  return `${pad(d.day)}.${pad(nm)}.${ny}`;
}

// the month's calendar: one RestDay query covers this month and the next one (document date)
async function monthCalendar(year, month) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const restDays = await restDaysBetween(from, new Date(Date.UTC(year, month + 1, 0)));
  const days = monthDays(year, month, restDays);
  return { days, workingDays: days.filter((d) => !d.weekend && !d.holiday).length, docDate: defaultDocDate(year, month, restDays) };
}

// several timesheets at once (the ZIP of all 8): 3 queries in total, not 3 per timesheet
async function computeGrids(sheets, year, month) {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const { days, workingDays, docDate } = await monthCalendar(year, month);

  const allMembers = await TimesheetMember.find({ sheet: { $in: sheets.map((s) => s.key) } }).sort({ order: 1, _id: 1 })
    .populate("employee", "firstName lastName isActive").lean();
  const empIds = allMembers.map((m) => m.employee?._id).filter(Boolean);
  const [entries, cells] = await Promise.all([
    LeaveEntry.find({ employee: { $in: empIds }, startDate: { $lte: to }, endDate: { $gte: from }, status: { $in: ["approved", null] } })
      .select("employee type startDate endDate days").lean(),
    TimesheetCell.find({ member: { $in: allMembers.map((m) => m._id) }, date: { $gte: days[0].key, $lte: days[days.length - 1].key } })
      .select("member date value").lean(),
  ]);
  const leaveBy = new Map();
  entries.forEach((e) => leaveDays(e).forEach((d) => {
    const k = String(e.employee);
    if (!leaveBy.has(k)) leaveBy.set(k, new Map());
    leaveBy.get(k).set(d.date, LEAVE_CODE[d.type]);
  }));
  const cellBy = new Map(cells.map((c) => [`${c.member}|${c.date}`, c.value]));

  const toRow = (m) => {
    const work = new Set(m.workDays?.length ? m.workDays : [1, 2, 3, 4, 5]);
    const leaves = (m.employee && leaveBy.get(String(m.employee._id))) || new Map();
    const values = [], auto = [], edited = [];
    for (const d of days) {
      const a = d.holiday || !work.has(d.wd) ? "დ" : leaves.get(d.key) || String(m.hours || 8);
      const own = cellBy.get(`${m._id}|${d.key}`);
      auto.push(a);
      values.push(own ?? a);
      edited.push(own !== undefined);
    }
    const nums = values.filter((v) => /^\d/.test(v)).map(Number);
    return {
      _id: m._id, nameKa: m.nameKa, personalId: m.personalId, position: m.position, hours: m.hours, workDays: m.workDays, order: m.order,
      employee: m.employee ? { _id: m.employee._id, name: `${m.employee.firstName} ${m.employee.lastName}`.trim(), isActive: m.employee.isActive !== false } : null,
      values, auto, edited,
      totalDays: nums.length, totalHours: nums.reduce((s, n) => s + n, 0),
    };
  };

  return sheets.map((sheet) => ({
    sheet: { _id: sheet._id, key: sheet.key, title: sheet.title, head: sheet.head, responsible: sheet.responsible },
    year, month, monthName: MONTHS_KA[month - 1], days, workingDays, docDate, capacity: FORM_CAPACITY,
    members: allMembers.filter((m) => m.sheet === sheet.key).map(toRow),
  }));
}
const computeGrid = async (sheet, year, month) => (await computeGrids([sheet], year, month))[0];

const fail = (res, err, where) => { console.error(`${where} failed:`, err); res.status(500).json({ error: "Server error" }); };

// GET /api/reports/timesheet/sheets
export async function listSheets(req, res) {
  try {
    const sheets = await TimesheetSheet.find(await allowedSheetFilter(req.employee)).sort({ order: 1 }).lean();
    const counts = await TimesheetMember.aggregate([{ $group: { _id: "$sheet", n: { $sum: 1 } } }]);
    const byKey = new Map(counts.map((c) => [c._id, c.n]));
    res.json(sheets.map((s) => ({ _id: s._id, key: s.key, title: s.title, head: s.head, responsible: s.responsible, members: byKey.get(s.key) || 0 })));
  } catch (err) { fail(res, err, "timesheet listSheets"); }
}

// PUT /api/reports/timesheet/sheets/:key   { title, head, responsible }
export async function updateSheet(req, res) {
  try {
    const sheet = await loadSheet(req, req.params.key);
    if (!sheet) return res.status(404).json({ error: "Not found" });
    const set = {};
    for (const f of ["title", "head", "responsible"]) if (typeof req.body[f] === "string") set[f] = req.body[f].trim().slice(0, 200);
    if (set.title === "") delete set.title;
    await TimesheetSheet.updateOne({ _id: sheet._id }, { $set: set });
    res.json({ ok: true });
  } catch (err) { fail(res, err, "timesheet updateSheet"); }
}

// GET /api/reports/timesheet/grid?sheet=div1-tbilisi&month=2026-10
export async function getGrid(req, res) {
  try {
    const sheet = await loadSheet(req, req.query.sheet);
    if (!sheet) return res.status(404).json({ error: "Not found" });
    const { year, month } = parseMonth(req.query.month);
    res.json(await computeGrid(sheet, year, month));
  } catch (err) { fail(res, err, "timesheet getGrid"); }
}

// PUT /api/reports/timesheet/cell   { member, date: "yyyy-mm-dd", value }  (empty value = back to automatic)
export async function setCell(req, res) {
  try {
    const { member, date } = req.body;
    const value = String(req.body.value ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ error: "Bad date" });
    const m = await TimesheetMember.findById(member).lean();
    if (!m || !(await loadSheet(req, m.sheet))) return res.status(404).json({ error: "Not found" });
    if (!value) {
      await TimesheetCell.deleteOne({ member, date });
    } else {
      if (!isValue(value)) return res.status(400).json({ error: "Bad value" });
      await TimesheetCell.updateOne({ member, date }, { $set: { value, updatedBy: req.employee._id } }, { upsert: true });
    }
    res.json({ ok: true });
  } catch (err) { fail(res, err, "timesheet setCell"); }
}

const fileName = (grid) => `ტაბელი - ${grid.sheet.title} - ${grid.monthName} ${grid.year}.xlsx`;
const toXlsx = (grid, docDate) => buildTimesheetXlsx(template(), {
  title: grid.sheet.title, year: grid.year, month: grid.month, docDate: docDate || grid.docDate,
  head: grid.sheet.head, responsible: grid.sheet.responsible, workingDays: grid.workingDays,
  days: grid.days, members: grid.members,
});

// GET /api/reports/timesheet/export?sheet=div1-tbilisi|all&month=2026-10&docDate=02.11.2026
export async function exportSheet(req, res) {
  try {
    const { year, month } = parseMonth(req.query.month);
    const docDate = /^\d{2}\.\d{2}\.\d{4}$/.test(String(req.query.docDate || "")) ? req.query.docDate : null;
    if (req.query.sheet === "all") {
      const sheets = await TimesheetSheet.find(await allowedSheetFilter(req.employee)).sort({ order: 1 }).lean();
      const zip = new JSZip();
      for (const grid of await computeGrids(sheets, year, month)) {
        if (grid.members.length) zip.file(fileName(grid), await toXlsx(grid, docDate), { compression: "STORE" });
      }
      const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`ტაბელები - ${MONTHS_KA[month - 1]} ${year}.zip`)}`);
      return res.send(buf);
    }
    const sheet = await loadSheet(req, req.query.sheet);
    if (!sheet) return res.status(404).json({ error: "Not found" });
    const grid = await computeGrid(sheet, year, month);
    const buf = await toXlsx(grid, docDate);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName(grid))}`);
    res.send(buf);
  } catch (err) { fail(res, err, "timesheet export"); }
}

// GET /api/reports/timesheet/available-employees  -> active CRM employees not on any timesheet
export async function availableEmployees(req, res) {
  try {
    const used = await TimesheetMember.distinct("employee", { employee: { $ne: null } });
    const list = await Employee.find({ _id: { $nin: used }, isActive: { $ne: false } }).select("firstName lastName").sort({ firstName: 1 }).lean();
    res.json(list.map((e) => ({ _id: e._id, name: `${e.firstName} ${e.lastName || ""}`.trim() })));
  } catch (err) { fail(res, err, "timesheet availableEmployees"); }
}

function memberFields(body) {
  const out = {};
  if (typeof body.nameKa === "string") out.nameKa = body.nameKa.trim().slice(0, 120);
  if (typeof body.personalId === "string") out.personalId = body.personalId.replace(/\s/g, "").slice(0, 20);
  if (typeof body.position === "string") out.position = body.position.trim().slice(0, 120);
  if (body.hours !== undefined) out.hours = Math.min(Math.max(Number(body.hours) || 8, 1), 24);
  if (Array.isArray(body.workDays)) out.workDays = [...new Set(body.workDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  if (body.employee !== undefined) out.employee = body.employee || null;
  return out;
}

// POST /api/reports/timesheet/members   { sheet, employee?, nameKa, personalId, position, hours, workDays }
export async function addMember(req, res) {
  try {
    const sheet = await loadSheet(req, req.body.sheet);
    if (!sheet) return res.status(404).json({ error: "Not found" });
    const data = memberFields(req.body);
    if (!data.nameKa) return res.status(400).json({ error: "Name is required" });
    const count = await TimesheetMember.countDocuments({ sheet: sheet.key });
    if (count >= FORM_CAPACITY) return res.status(400).json({ error: `Max ${FORM_CAPACITY} people` });
    const last = await TimesheetMember.findOne({ sheet: sheet.key }).sort({ order: -1 }).select("order").lean();
    const m = await TimesheetMember.create({ ...data, sheet: sheet.key, order: (last?.order || 0) + 1 });
    res.status(201).json(m);
  } catch (err) { fail(res, err, "timesheet addMember"); }
}

// PUT /api/reports/timesheet/members/:id   (also { sheet } to move to another timesheet)
export async function updateMember(req, res) {
  try {
    const m = await TimesheetMember.findById(req.params.id);
    if (!m || !(await loadSheet(req, m.sheet))) return res.status(404).json({ error: "Not found" });
    Object.assign(m, memberFields(req.body));
    if (req.body.sheet && req.body.sheet !== m.sheet) {
      const target = await loadSheet(req, req.body.sheet);
      if (!target) return res.status(404).json({ error: "Not found" });
      const last = await TimesheetMember.findOne({ sheet: target.key }).sort({ order: -1 }).select("order").lean();
      m.sheet = target.key;
      m.order = (last?.order || 0) + 1;
    }
    await m.save();
    res.json(m);
  } catch (err) { fail(res, err, "timesheet updateMember"); }
}

// POST /api/reports/timesheet/members/:id/move   { dir: -1 | 1 }
export async function moveMember(req, res) {
  try {
    const m = await TimesheetMember.findById(req.params.id);
    if (!m || !(await loadSheet(req, m.sheet))) return res.status(404).json({ error: "Not found" });
    const list = await TimesheetMember.find({ sheet: m.sheet }).sort({ order: 1, _id: 1 });
    const i = list.findIndex((x) => String(x._id) === String(m._id));
    const j = i + (Number(req.body.dir) < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return res.json({ ok: true });
    [list[i], list[j]] = [list[j], list[i]];
    await TimesheetMember.bulkWrite(list.map((x, k) => ({ updateOne: { filter: { _id: x._id }, update: { $set: { order: k + 1 } } } })));
    res.json({ ok: true });
  } catch (err) { fail(res, err, "timesheet moveMember"); }
}

// DELETE /api/reports/timesheet/members/:id
export async function removeMember(req, res) {
  try {
    const m = await TimesheetMember.findById(req.params.id).lean();
    if (!m || !(await loadSheet(req, m.sheet))) return res.status(404).json({ error: "Not found" });
    await Promise.all([TimesheetMember.deleteOne({ _id: m._id }), TimesheetCell.deleteMany({ member: m._id })]);
    res.json({ ok: true });
  } catch (err) { fail(res, err, "timesheet removeMember"); }
}
