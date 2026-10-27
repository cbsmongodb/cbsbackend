// Writes one month of one timesheet into the official Excel form
// (src/templates/timesheet-master.xlsx, made from the company's own file).
// Only cell values change: the day columns a short month does not have and
// the unused person rows are hidden, so fonts, borders, merges, colours and
// the total formulas stay exactly as in the form.
import JSZip from "jszip";

export const MONTHS_KA = ["იანვარი", "თებერვალი", "მარტი", "აპრილი", "მაისი", "ივნისი", "ივლისი", "აგვისტო", "სექტემბერი", "ოქტომბერი", "ნოემბერი", "დეკემბერი"];
const WEEKDAYS_KA = ["კვირა", "ორშაბათი", "სამშაბათი", "ოთხშაბათი", "ხუთშაბათი", "პარასკევი", "შაბათი"];

export const FORM_CAPACITY = 45; // person rows in the form (15..59)
const FIRST_ROW = 15;
const DAY_COL = 5;               // column E = day 1
const HEAD_CELL = "E64";
const RESP_CELL = "E67";

const colName = (n) => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

function setCell(xml, ref, value) {
  const re = new RegExp(`<c r="${ref}"(\\s[^>]*?)?(?:/>|>[\\s\\S]*?</c>)`);
  const m = xml.match(re);
  if (!m) throw new Error(`timesheet form: cell ${ref} not found`);
  const style = (m[1] || "").match(/\ss="(\d+)"/);
  const s = style ? ` s="${style[1]}"` : "";
  let cell;
  if (value === null || value === undefined || value === "") cell = `<c r="${ref}"${s}/>`;
  else if (typeof value === "number") cell = `<c r="${ref}"${s}><v>${value}</v></c>`;
  else cell = `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  return xml.replace(re, () => cell);
}
const hideRow = (xml, r) => xml.replace(new RegExp(`<row r="${r}"(?![0-9])([^>]*?)>`), (all, attrs) => (attrs.includes("hidden=") ? all : `<row r="${r}"${attrs} hidden="1">`));
const hideCol = (xml, n) => xml.replace(new RegExp(`<col([^>]*?)min="${n}" max="${n}"\\s*/>`), (all, attrs) => (attrs.includes('hidden="1"') ? all : `<col hidden="1"${attrs}min="${n}" max="${n}"/>`));

// a cell value from the grid: numbers ("8") as numbers so the totals count them
const toCell = (v) => (v === null || v === undefined || v === "" ? null : /^\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v));

/**
 * grid = { title, year, month, docDate, head, responsible, workingDays,
 *          days: [{ day, wd }], members: [{ nameKa, personalId, position, values: [per day] }] }
 */
export async function buildTimesheetXlsx(templateBuffer, grid) {
  const { title, year, month, docDate, head, responsible, workingDays, days, members } = grid;
  if (members.length > FORM_CAPACITY) throw new Error(`the form holds at most ${FORM_CAPACITY} people`);
  const zip = await JSZip.loadAsync(templateBuffer);
  const path = "xl/worksheets/sheet1.xml";
  let xml = await zip.file(path).async("string");

  xml = setCell(xml, "V2", docDate);
  xml = setCell(xml, "C4", title);
  xml = setCell(xml, "AK4", year);
  xml = setCell(xml, "V5", 1);
  xml = setCell(xml, "W5", MONTHS_KA[month - 1]);
  xml = setCell(xml, "AD5", days.length);
  xml = setCell(xml, "AE5", MONTHS_KA[month - 1]);
  xml = setCell(xml, "AL9", workingDays);
  for (let i = 0; i < 31; i++) {
    const col = colName(DAY_COL + i);
    const d = days[i];
    xml = setCell(xml, `${col}11`, d ? serial(year, month, d.day) : null);
    xml = setCell(xml, `${col}12`, d ? WEEKDAYS_KA[d.wd] : null);
    if (!d) xml = hideCol(xml, DAY_COL + i);
  }
  members.forEach((p, idx) => {
    const r = FIRST_ROW + idx;
    xml = setCell(xml, `B${r}`, p.nameKa);
    xml = setCell(xml, `C${r}`, String(p.personalId || ""));
    xml = setCell(xml, `D${r}`, p.position || "");
    for (let i = 0; i < 31; i++) xml = setCell(xml, `${colName(DAY_COL + i)}${r}`, i < days.length ? toCell(p.values[i]) : null);
  });
  for (let r = FIRST_ROW + members.length; r < FIRST_ROW + FORM_CAPACITY; r++) xml = hideRow(xml, r);
  xml = setCell(xml, HEAD_CELL, head || "");
  xml = setCell(xml, RESP_CELL, responsible || "");

  zip.file(path, xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
