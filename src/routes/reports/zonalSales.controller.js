// Zonal sales report.
//   GET /api/reports/zonal-sales/divisions          -> divisions this user may see
//   GET /api/reports/zonal-sales?month=YYYY-MM[&division=]          -> raw rows
//   GET /api/reports/zonal-sales/summary?month=YYYY-MM[&division=]  -> zones / chains / products for the map
// Director / finance / office (and admin) see every division; a division manager only their own.
// Access itself is the "zonal_sales" privilege (see scripts/grantZonalSales.js).
import mongoose from "mongoose";
import ZonalSale from "../../models/ZonalSale.js";
import Section from "../../models/Section.js";
import Employee from "../../models/Employee.js";
import Group from "../../models/Group.js";
import { getScopeEmployeeIds, seesEverything } from "../../utils/groupVisibility.js";

const isMonth = (s) => /^\d{4}-\d{2}$/.test(s || "");

// null = every division; otherwise a Set of the division (Section) ids this user may see
export async function allowedDivisionIds(employee) {
  if (employee?.role?.name === "admin" || seesEverything(employee)) return null;
  const scope = await getScopeEmployeeIds(employee);
  if (!scope) return null;
  const ids = scope.map(String);
  const mine = new Set();
  const emps = await Employee.find({ _id: { $in: ids } }).select("group").lean();
  const groups = await Group.find({ $or: [{ _id: { $in: emps.map((e) => e.group).filter(Boolean) } }, { head: { $in: ids } }] }).select("section").lean();
  groups.forEach((g) => g.section && mine.add(String(g.section)));
  // groups linked to a division only from the Division page
  (await Section.find({ groups: { $in: groups.map((g) => g._id) } }).select("_id").lean()).forEach((s) => mine.add(String(s._id)));
  const headed = await Section.find({ head: { $in: ids } }).select("_id").lean();
  headed.forEach((s) => mine.add(String(s._id)));
  return mine;
}

async function visibleDivisions(employee) {
  const all = await Section.find({ name: /DIVIZION/i }).sort({ name: 1 }).select("name").lean();
  const allowed = await allowedDivisionIds(employee);
  return allowed ? all.filter((s) => allowed.has(String(s._id))) : all;
}

export async function getZonalDivisions(req, res) {
  try {
    const list = await visibleDivisions(req.employee);
    res.json(list.map(({ _id, name }) => ({ _id, name })));
  } catch (err) {
    console.error("zonal divisions failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getZonalSales(req, res) {
  try {
    const { month, division } = req.query;
    const allowed = await allowedDivisionIds(req.employee);

    // which divisions this request covers
    let divIds = null; // null = all
    if (allowed) divIds = [...allowed];
    if (division) {
      if (allowed && !allowed.has(String(division))) return res.status(403).json({ error: "ეს დივიზიონი თქვენთვის დახურულია" });
      divIds = [String(division)];
    }
    const scopeFilter = divIds ? { division: { $in: divIds } } : {};

    // months that have data (newest first) — the page opens on the latest one
    const months = (await ZonalSale.distinct("month", scopeFilter)).sort().reverse();
    const pick = isMonth(month) ? month : months[0] || null;
    if (!pick) return res.json({ months, month: null, columns: [], rows: [] });

    const rows = await ZonalSale.find({ ...scopeFilter, month: pick })
      .populate("division", "name")
      .select("month division zone data")
      .sort({ division: 1, zone: 1, _id: 1 })
      .lean();

    // columns in the order they first appear
    const columns = [];
    const seen = new Set();
    rows.forEach((r) => Object.keys(r.data || {}).forEach((k) => { if (!seen.has(k)) { seen.add(k); columns.push(k); } }));

    res.json({
      months,
      month: pick,
      columns,
      rows: rows.map((r) => ({ _id: r._id, division: r.division?.name || null, zone: r.zone || null, data: r.data || {} })),
    });
  } catch (err) {
    console.error("zonal sales failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// what the map dashboard needs, already added up:
//   zones (sales per zone), zoneProducts (zone x product), zoneChains (zone x pharmacy chain)
export async function getZonalSummary(req, res) {
  try {
    const { month, division } = req.query;
    const allowed = await allowedDivisionIds(req.employee);
    let divIds = allowed ? [...allowed] : null;
    if (division) {
      if (allowed && !allowed.has(String(division))) return res.status(403).json({ error: "ეს დივიზიონი თქვენთვის დახურულია" });
      divIds = [String(division)];
    }
    const scope = divIds ? { division: { $in: divIds.map((id) => new mongoose.Types.ObjectId(id)) } } : {};

    const months = (await ZonalSale.distinct("month", scope)).sort().reverse();
    const pick = isMonth(month) ? month : months[0] || null;
    const empty = { months, month: pick, zones: [], zoneProducts: [], zoneChains: [] };
    if (!pick) return res.json(empty);

    const match = { $match: { ...scope, month: pick } };
    const sum = { amount: { $sum: "$amount" }, qty: { $sum: "$qty" } };
    const [zones, zoneProducts, zoneChains] = await Promise.all([
      ZonalSale.aggregate([match, { $group: { _id: "$zone", ...sum } }]),
      ZonalSale.aggregate([match, { $group: { _id: { zone: "$zone", product: "$product" }, ...sum } }]),
      ZonalSale.aggregate([match, { $group: { _id: { zone: "$zone", chain: "$chain" }, ...sum } }]),
    ]);
    res.json({
      months,
      month: pick,
      zones: zones.map((z) => ({ zone: z._id || "—", amount: z.amount, qty: z.qty })),
      zoneProducts: zoneProducts.map((z) => ({ zone: z._id.zone || "—", product: z._id.product || "—", amount: z.amount, qty: z.qty })),
      zoneChains: zoneChains.map((z) => ({ zone: z._id.zone || "—", chain: z._id.chain || "—", amount: z.amount, qty: z.qty })),
    });
  } catch (err) {
    console.error("zonal summary failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
