import Doctor from "../../models/Doctor.js";

const POPULATE = "profile doctorCategory hospitals.hospital";

export async function getAllDoctors(req, res) {
  try {
    const { page, limit, search } = req.query;

    // matches the filters shown on the Doctors list: division, group, period
    const filter = {};
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      filter.$or = [{ firstName: regex }, { lastName: regex }, { uniqueNumber: regex }];
    }
    // division/group filters plug in here once doctors carry those refs

    if (!page && !limit) {
      const doctors = await Doctor.find(filter).populate(POPULATE).sort({ firstName: 1 });
      return res.json(doctors);
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      Doctor.find(filter).populate(POPULATE).sort({ firstName: 1 }).skip(skip).limit(limitNum),
      Doctor.countDocuments(filter),
    ]);

    res.json({
      docs,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAllDoctors failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function getDoctor(req, res) {
  try {
    const doctor = await Doctor.findById(req.params.id).populate(POPULATE);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    res.json(doctor);
  } catch (err) {
    console.error("getDoctor failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function createDoctor(req, res) {
  try {
    const doctor = await Doctor.create(req.body);
    res.status(201).json(doctor);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: "A doctor with this unique number already exists" });
    }
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }
    console.error("createDoctor failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function updateDoctor(req, res) {
  try {
    const doctor = await Doctor.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    }).populate(POPULATE);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    res.json(doctor);
  } catch (err) {
    console.error("updateDoctor failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

export async function deleteDoctor(req, res) {
  try {
    const doctor = await Doctor.findByIdAndDelete(req.params.id);
    if (!doctor) return res.status(404).json({ error: "Doctor not found" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteDoctor failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
