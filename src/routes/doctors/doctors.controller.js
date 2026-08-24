import Doctor from "../../models/Doctor.js";

const POPULATE = "profile category subcategory hospitals";

export async function getAllDoctors(req, res) {
  try {
    // matches the filters shown on the Doctors list: division, group, period
    const filter = {};
    if (req.query.search) filter.name = new RegExp(req.query.search, "i");
    // division/group filters plug in here once doctors carry those refs

    const doctors = await Doctor.find(filter).populate(POPULATE).sort({ name: 1 });
    res.json(doctors);
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
