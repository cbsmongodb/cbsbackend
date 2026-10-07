import DoctorEntryItem from "../../models/DoctorEntryItem.js";
import { getScopeEmployeeIds } from "../../utils/groupVisibility.js";

// GET /api/reports/prescriptions?from=YYYY-MM&to=YYYY-MM&employee=
// Every Data Entry line with a prescription (> 0): who, which doctor, hospital,
// drug, how many boxes were prescribed and how many were sold.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// periods are "the 1st of the month"; depending on where they were saved that is
// midnight UTC or midnight Georgia time (20:00 UTC the day before). A window
// shifted by 12h catches both without touching the neighbouring month.
const HALF_DAY = 12 * 3600 * 1000;
function monthStart(m) {
  return new Date(new Date(`${m}-01T00:00:00Z`).getTime() - HALF_DAY);
}
function nextMonthStart(m) {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 1) - HALF_DAY);
}
function monthOf(date) {
  const d = new Date(new Date(date).getTime() + HALF_DAY);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
const fullName = (p) => (p ? `${p.firstName || ""} ${p.lastName || ""}`.trim() || p.name || "" : "");

export async function getPrescriptionsReport(req, res) {
  try {
    const now = new Date();
    const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const from = MONTH_RE.test(req.query.from || "") ? req.query.from : current;
    let to = MONTH_RE.test(req.query.to || "") ? req.query.to : from;
    if (to < from) to = from;

    const filter = {
      period: { $gte: monthStart(from), $lt: nextMonthStart(to) },
      prescription: { $gt: 0 },
    };
    if (req.query.employee) filter.employee = req.query.employee;

    const scopeIds = await getScopeEmployeeIds(req.employee);
    if (scopeIds) {
      const allowed = new Set(scopeIds.map(String));
      if (filter.employee) {
        if (!allowed.has(String(filter.employee))) filter.employee = { $in: [] };
      } else {
        filter.employee = { $in: scopeIds };
      }
    }

    const items = await DoctorEntryItem.find(filter)
      .populate("employee", "firstName lastName")
      .populate("doctor", "firstName lastName uniqueNumber")
      .populate("drug", "name")
      .populate("hospital", "name")
      .sort({ period: -1 })
      .limit(20000)
      .lean();

    res.json(
      items.map((i) => ({
        _id: i._id,
        month: monthOf(i.period),
        employeeName: fullName(i.employee),
        doctorName: fullName(i.doctor),
        doctorNumber: i.doctor?.uniqueNumber || "",
        hospitalName: i.hospital?.name || "",
        drugName: i.drug?.name || "",
        prescription: i.prescription || 0,
        sale: i.sale || 0,
      }))
    );
  } catch (err) {
    console.error("getPrescriptionsReport failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
