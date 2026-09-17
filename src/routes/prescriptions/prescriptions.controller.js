import Prescription from "../../models/Prescription.js";
import DrugPrescription from "../../models/DrugPrescription.js";
import Employee from "../../models/Employee.js";
import Doctor from "../../models/Doctor.js";
import Drug from "../../models/Drug.js";

// GET /api/prescriptions
// ?search=&doctor=&employee=&fromDate=&toDate=&isActive=&page=&limit=
// Matches the old Rails PrescriptionDatatable: isActive defaults to true,
// free-text search matches employee/doctor name OR a prescribed drug's name.
export async function getAllPrescriptions(req, res) {
  try {
    const { search, doctor, employee, fromDate, toDate, page, limit } = req.query;
    const isActive = req.query.isActive === undefined ? true : req.query.isActive === "true";

    const filter = { isActive };
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

      const [matchingEmployees, matchingDoctors, matchingDrugs] = await Promise.all([
        Employee.find({ $or: [{ firstName: regex }, { lastName: regex }] }).distinct("_id"),
        Doctor.find({ $or: [{ firstName: regex }, { lastName: regex }] }).distinct("_id"),
        Drug.find({ name: regex }).distinct("_id"),
      ]);

      const matchingPrescriptionIds = matchingDrugs.length
        ? await DrugPrescription.find({ drug: { $in: matchingDrugs } }).distinct("prescription")
        : [];

      filter.$or = [
        { employee: { $in: matchingEmployees } },
        { doctor: { $in: matchingDoctors } },
        { _id: { $in: matchingPrescriptionIds } },
      ];
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      Prescription.find(filter)
        .populate("employee", "firstName lastName")
        .populate("doctor", "firstName lastName isBudgeted")
        .sort({ date: -1 })
        .skip(skip)
        .limit(limitNum),
      Prescription.countDocuments(filter),
    ]);

    const prescriptionIds = docs.map((d) => d._id);
    const drugPrescriptions = await DrugPrescription.find({
      prescription: { $in: prescriptionIds },
    }).populate("drug", "name");

    const byPrescription = new Map();
    drugPrescriptions.forEach((dp) => {
      const key = String(dp.prescription);
      if (!byPrescription.has(key)) byPrescription.set(key, []);
      byPrescription.get(key).push({
        drugName: dp.drug?.name || "—",
        totalNoOfBoxes: dp.totalNoOfBoxes || 0,
      });
    });

    const rows = docs.map((d) => {
      const items = byPrescription.get(String(d._id)) || [];
      return {
        _id: d._id,
        date: d.date,
        doctorName: d.doctor?.name || "—",
        doctorIsBudgeted: !!d.doctor?.isBudgeted,
        employeeName: d.employee?.name || "—",
        drugDetails: items.map((i) => `${i.drugName} ->${i.totalNoOfBoxes}`).join(", "),
        totalBoxes: items.reduce((sum, i) => sum + i.totalNoOfBoxes, 0),
        isActive: d.isActive,
      };
    });

    res.json({
      docs: rows,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAllPrescriptions failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function toggleActive(req, res) {
  try {
    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) return res.status(404).json({ error: "Not found" });
    prescription.isActive = !prescription.isActive;
    await prescription.save();
    res.json(prescription);
  } catch (err) {
    console.error("toggleActive failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deletePrescription(req, res) {
  try {
    await DrugPrescription.deleteMany({ prescription: req.params.id });
    const deleted = await Prescription.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deletePrescription failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/prescriptions
export async function createPrescription(req, res) {
  try {
    const { doctor, employee, date, note, isActive } = req.body;
    if (!doctor || !employee) {
      return res.status(400).json({ error: "Doctor and employee are required" });
    }
    const prescription = await Prescription.create({
      doctor,
      employee,
      date: date || new Date(),
      note: note || "",
      isActive: isActive !== undefined ? isActive : true,
    });
    res.status(201).json(prescription);
  } catch (err) {
    console.error("createPrescription failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// GET /api/prescriptions/:id — full detail for the edit form: the
// prescription itself + its drug lines (with sale boxes) + the active
// drug list for the "add medicine" dropdown
export async function getPrescriptionById(req, res) {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate("doctor", "firstName lastName uniqueNumber")
      .populate("employee", "firstName lastName");
    if (!prescription) return res.status(404).json({ error: "Not found" });

    const [drugPrescriptions, activeDrugs] = await Promise.all([
      DrugPrescription.find({ prescription: prescription._id }).populate("drug", "name"),
      Drug.find({ isActive: true }).select("name").sort({ name: 1 }),
    ]);

    res.json({
      _id: prescription._id,
      date: prescription.date,
      note: prescription.note,
      isActive: prescription.isActive,
      doctor: prescription.doctor
        ? { _id: prescription.doctor._id, name: prescription.doctor.name, uniqueNumber: prescription.doctor.uniqueNumber }
        : null,
      employee: prescription.employee
        ? { _id: prescription.employee._id, name: prescription.employee.name }
        : null,
      drugLines: drugPrescriptions.map((dp) => ({
        _id: dp._id,
        drugId: dp.drug?._id,
        drugName: dp.drug?.name || "—",
        totalNoOfBoxes: dp.totalNoOfBoxes || 0,
        saleBoxes: dp.saleBoxes || 0,
      })),
      activeDrugs: activeDrugs.map((d) => ({ _id: d._id, name: d.name })),
    });
  } catch (err) {
    console.error("getPrescriptionById failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// POST /api/prescriptions/:id/drugs
// body: either { drugId, totalNoOfBoxes } for one line, or
// { items: [{ drugId, totalNoOfBoxes }, ...] } for "Add Multiple Medicines" —
// find-or-create per drug, matching Rails' add_drug_details behavior
export async function addDrugDetails(req, res) {
  try {
    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) return res.status(404).json({ error: "Not found" });

    const items = Array.isArray(req.body.items)
      ? req.body.items
      : [{ drugId: req.body.drugId, totalNoOfBoxes: req.body.totalNoOfBoxes }];

    for (const item of items) {
      if (!item.drugId || item.totalNoOfBoxes === undefined || item.totalNoOfBoxes === "") continue;
      let dp = await DrugPrescription.findOne({ prescription: prescription._id, drug: item.drugId });
      if (dp) {
        dp.totalNoOfBoxes = parseInt(item.totalNoOfBoxes, 10) || 0;
        await dp.save();
      } else {
        await DrugPrescription.create({
          prescription: prescription._id,
          drug: item.drugId,
          totalNoOfBoxes: parseInt(item.totalNoOfBoxes, 10) || 0,
          saleBoxes: 0,
        });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("addDrugDetails failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// DELETE /api/prescriptions/:id/drugs/:drugPrescriptionId
export async function removeDrugPrescription(req, res) {
  try {
    const deleted = await DrugPrescription.findOneAndDelete({
      _id: req.params.drugPrescriptionId,
      prescription: req.params.id,
    });
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("removeDrugPrescription failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// PUT /api/drug-prescriptions/:id — updates just the saleBoxes field on one
// drug line. Validates saleBoxes <= totalNoOfBoxes, matching Rails'
// DrugPrescriptionsController#update exactly.
export async function updateDrugPrescriptionSaleBoxes(req, res) {
  try {
    const dp = await DrugPrescription.findById(req.params.id);
    if (!dp) return res.status(404).json({ error: "Not found" });

    const saleBoxes = parseInt(req.body.saleBoxes, 10) || 0;
    if ((dp.totalNoOfBoxes || 0) < saleBoxes) {
      return res.status(400).json({ error: "Sale boxes cannot exceed total no of boxes" });
    }

    dp.saleBoxes = saleBoxes;
    await dp.save();
    res.json(dp);
  } catch (err) {
    console.error("updateDrugPrescriptionSaleBoxes failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// PUT /api/prescriptions/:id — update header fields (date, isActive, note)
export async function updatePrescription(req, res) {
  try {
    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) return res.status(404).json({ error: "Not found" });

    const { date, isActive, note } = req.body;
    if (date !== undefined) prescription.date = date;
    if (isActive !== undefined) prescription.isActive = isActive;
    if (note !== undefined) prescription.note = note;
    await prescription.save();

    res.json(prescription);
  } catch (err) {
    console.error("updatePrescription failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
