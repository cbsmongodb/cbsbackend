import DoctorTarget from "../../models/DoctorTarget.js";
import MedicineTarget from "../../models/MedicineTarget.js";
import Employee from "../../models/Employee.js";
import Doctor from "../../models/Doctor.js";

// GET /api/doctor-targets?search=&doctor=&employee=&fromDate=&toDate=&page=&limit=
export async function getAllDoctorTargets(req, res) {
  try {
    const { search, doctor, employee, fromDate, toDate, page, limit } = req.query;

    const filter = {};
    if (doctor) filter.doctor = doctor;
    if (employee) filter.employee = employee;
    if (fromDate && toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      filter.date = { $gte: new Date(fromDate), $lte: to };
    }

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const [matchingDoctors, matchingEmployees] = await Promise.all([
        Doctor.find({ $or: [{ firstName: regex }, { lastName: regex }] }).distinct("_id"),
        Employee.find({ $or: [{ firstName: regex }, { lastName: regex }] }).distinct("_id"),
      ]);
      filter.$or = [
        { doctor: { $in: matchingDoctors } },
        { employee: { $in: matchingEmployees } },
      ];
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      DoctorTarget.find(filter)
        .populate("doctor", "firstName lastName")
        .populate("employee", "firstName lastName")
        .sort({ date: 1 })
        .skip(skip)
        .limit(limitNum),
      DoctorTarget.countDocuments(filter),
    ]);

    const targetIds = docs.map((d) => d._id);
    const targets = await MedicineTarget.find({
      medicineTargatableType: "DoctorTarget",
      medicineTargatableId: { $in: targetIds },
    }).populate("drug", "price");

    const amountByTarget = new Map();
    targets.forEach((t) => {
      const key = String(t.medicineTargatableId);
      const amount = (t.totalNoOfBoxes || 0) * (t.drug?.price || 0);
      amountByTarget.set(key, (amountByTarget.get(key) || 0) + amount);
    });

    const rows = docs.map((d) => ({
      _id: d._id,
      date: d.date,
      doctorName: d.doctor?.name || "—",
      employeeName: d.employee?.name || "—",
      targetAmount: Math.round((amountByTarget.get(String(d._id)) || 0) * 100) / 100,
    }));

    res.json({
      docs: rows,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAllDoctorTargets failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteDoctorTarget(req, res) {
  try {
    await MedicineTarget.deleteMany({
      medicineTargatableType: "DoctorTarget",
      medicineTargatableId: req.params.id,
    });
    const deleted = await DoctorTarget.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteDoctorTarget failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
