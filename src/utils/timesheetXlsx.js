// Writes one month of one timesheet into the official Excel form
// (src/templates/timesheet-master.xlsx, made from the company's own file).
// Only cell values change: the day columns a short month does not have and
// the unused person rows are hidden, so fonts, borders, merges, colours and
// the total formulas stay exactly as in the form.
//
// Speed: all changes are collected first and the sheet XML is rewritten in ONE
// pass (≈1 500 cells), instead of searching the whole file once per cell.
import JSZip from "jszip";

export const MONTHS_KA = ["იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი", "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი"];
const WEEKDAYS_KA = ["კვირა", "ორშაბათი", "სამშაბათი", "ოთხშაბათი", "ხუთშაბათი", "პარასკევი", "შაბათი"];

export const FORM_CAPACITY = 45; // person rows in the form (15..59)
const FIRST_ROW = 15;
const DAY_COL = 5;               // column E = day 1
const HEAD_CELL = "E64";
const RESP_CELL = "E67";
const SHEET_PATH = "xl/worksheets/sheet1.xml";

const colName = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const DAY_COLS = Array.from({ length: 31 }, (_, i) => colName(DAY_COL + i));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
// a grid value: numbers ("8") as numbers so the form's totals count them
const toCell = (v) => (v === null || v === undefined || v === "" ? null : /^\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v));

function renderCell(ref, attrs, value) {
  const style = (attrs || "").match(/\ss="(\d+)"/);
  const s = style ? ` s="${style[1]}"` : "";
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${s}/>`;
  if (typeof value === "number") return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

// the form's sheet XML is read from the template once and reused
let cached = null;
async function formXml(templateBuffer) {
  if (!cached || cached.buf !== templateBuffer) {
    const zip = await JSZip.loadAsync(templateBuffer);
    cached = { buf: templateBuffer, xml: await zip.file(SHEET_PATH).async("string") };
  }
  return cached.xml;
}

/**
 * grid = { title, year, month, docDate, head, responsible, workingDays,
 *          days: [{ day, wd }], members: [{ nameKa, personalId, position, values: [per day] }] }
 */
export async function buildTimesheetXlsx(templateBuffer, grid) {
  const { title, year, month, docDate, head, responsible, workingDays, days, members } = grid;
  if (members.length > FORM_CAPACITY) throw new Error(`the form holds at most ${FORM_CAPACITY} people`);

  // 1) every cell that changes
  const set = new Map([
    ["V2", docDate], ["C4", title], ["AK4", year], ["V5", 1],
    ["W5", MONTHS_KA[month - 1]], ["AD5", days.length], ["AE5", MONTHS_KA[month - 1]],
    ["AL9", workingDays], [HEAD_CELL, head || ""], [RESP_CELL, responsible || ""],
  ]);
  for (let i = 0; i < 31; i++) {
    const d = days[i];
    set.set(`${DAY_COLS[i]}11`, d ? serial(year, month, d.day) : null);
    set.set(`${DAY_COLS[i]}12`, d ? WEEKDAYS_KA[d.wd] : null);
  }
  members.forEach((p, idx) => {
    const r = FIRST_ROW + idx;
    set.set(`B${r}`, p.nameKa);
    set.set(`C${r}`, String(p.personalId || ""));
    set.set(`D${r}`, p.position || "");
    for (let i = 0; i < 31; i++) set.set(`${DAY_COLS[i]}${r}`, i < days.length ? toCell(p.values[i]) : null);
  });
  const hideRows = new Set();
  for (let r = FIRST_ROW + members.length; r < FIRST_ROW + FORM_CAPACITY; r++) hideRows.add(String(r));
  const hideCols = new Set();
  for (let i = days.length; i < 31; i++) hideCols.add(String(DAY_COL + i));

  // 2) one pass over the XML
  let xml = await formXml(templateBuffer);
  const found = new Set();
  xml = xml.replace(/<c r="([A-Z]+\d+)"(\s[^>]*?)?(?:\/>|>[\s\S]*?<\/c>)/g, (all, ref, attrs) => {
    if (!set.has(ref)) return all;
    found.add(ref);
    return renderCell(ref, attrs, set.get(ref));
  });
  if (found.size !== set.size) {
    const missing = [...set.keys()].filter((k) => !found.has(k));
    throw new Error(`timesheet form: cells not found: ${missing.slice(0, 5).join(", ")}`);
  }
  if (hideRows.size) {
    xml = xml.replace(/<row r="(\d+)"([^>]*?)>/g, (all, r, attrs) => (hideRows.has(r) && !attrs.includes("hidden=") ? `<row r="${r}"${attrs} hidden="1">` : all));
  }
  if (hideCols.size) {
    xml = xml.replace(/<col([^>]*?)min="(\d+)" max="(\d+)"\s*\/>/g, (all, attrs, min, max) =>
      (min === max && hideCols.has(min) && !attrs.includes('hidden="1"') ? `<col hidden="1"${attrs}min="${min}" max="${max}"/>` : all));
  }

  // 3) the file: the template with the new sheet
  const zip = await JSZip.loadAsync(templateBuffer);
  zip.file(SHEET_PATH, xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
