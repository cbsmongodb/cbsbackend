import express from "express";
import Hospital from "../../models/Hospital.js";
import Region from "../../models/Region.js";
import Doctor from "../../models/Doctor.js";
import { crud, exportExcel } from "../../utils/crudFactory.js";
import { requireAuth } from "../../middleware/auth.js";
import { geocodeAddress, searchAddress } from "../../utils/geocode.js";

export default function hospitalsRoutes(io) {
  const router = express.Router();
  router.use(requireAuth);

  const c = crud(Hospital, "region");
  router.get("/", c.getAll);
  router.post("/", c.createOne);

  router.get(
    "/export",
    exportExcel(
      Hospital,
      [
        { header: "Name", key: "name", width: 28 },
        { header: "Address", key: "address", width: 32 },
        { header: "Phone", key: "phoneNumber", width: 18 },
        { header: "Email", key: "email", width: 24 },
        { header: "Active", key: "isActive", width: 10 },
      ],
      "region"
    )
  );

  router.get("/missing-coordinates", async (req, res) => {
    try {
      const hospitals = await Hospital.find({
        $or: [{ lat: null }, { lat: { $exists: false } }],
      }).select("name address");
      res.json(hospitals);
    } catch (err) {
      console.error("missing-coordinates failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.get("/geocode-search", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || q.trim().length < 2) {
        return res.status(400).json({ error: "q is required (min 2 chars)" });
      }
      const results = await searchAddress(q);
      res.json(results);
    } catch (err) {
      console.error("geocode-search failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post("/bulk-import", async (req, res) => {
    try {
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: "rows must be a non-empty array" });
      }

      const regionCache = new Map();

      let created = 0;
      let skipped = 0;
      const regionsCreated = [];

      for (const row of rows) {
        const name = (row.name || "").trim();
        if (!name) continue;

        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const existing = await Hospital.findOne({ name: new RegExp(`^${escaped}$`, "i") });
        if (existing) {
          skipped++;
          continue;
        }

        let regionId = null;
        const regionName = (row.region || "").trim();
        if (regionName) {
          const key = regionName.toLowerCase();
          if (regionCache.has(key)) {
            regionId = regionCache.get(key);
          } else {
            const escapedRegion = regionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            let region = await Region.findOne({ name: new RegExp(`^${escapedRegion}$`, "i") });
            if (!region) {
              region = await Region.create({ name: regionName, isActive: true });
              regionsCreated.push(regionName);
            }
            regionId = region._id;
            regionCache.set(key, regionId);
          }
        }

        await Hospital.create({
          name,
          region: regionId,
          address: (row.address || "").trim(),
          phoneNumber: (row.phoneNumber || "").trim(),
          email: (row.email || "").trim(),
          isActive: true,
        });
        created++;
      }

      res.json({ created, skipped, regionsCreated });
    } catch (err) {
      console.error("bulk-import hospitals failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post("/geocode-missing", async (req, res) => {
    try {
      const hospitals = await Hospital.find({
        address: { $exists: true, $ne: "" },
        $or: [{ lat: null }, { lat: { $exists: false } }],
      });

      const total = hospitals.length;
      let geocoded = 0;
      let failed = 0;
      let processed = 0;
      const failedHospitals = [];

      for (const hospital of hospitals) {
        const coords = await geocodeAddress(hospital.address);
        if (coords) {
          hospital.lat = coords.lat;
          hospital.lng = coords.lng;
          await hospital.save();
          geocoded++;
        } else {
          failed++;
          failedHospitals.push({
            _id: hospital._id,
            name: hospital.name,
            address: hospital.address,
          });
        }
        processed++;
        if (io) io.emit("geocode:progress", { processed, total });
      }

      res.json({ total, geocoded, failed, failedHospitals });
    } catch (err) {
      console.error("geocode-missing hospitals failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // --- doctors in a hospital ---

  router.get("/:id/doctors", async (req, res) => {
    try {
      const doctors = await Doctor.find({ "hospitals.hospital": req.params.id })
        .select("firstName lastName uniqueNumber isActive")
        .sort({ firstName: 1, lastName: 1 });
      res.json(doctors.map((d) => ({
        _id: d._id,
        name: [d.firstName, d.lastName].filter(Boolean).join(" "),
        uniqueNumber: d.uniqueNumber,
        isActive: d.isActive,
      })));
    } catch (err) {
      console.error("get hospital doctors failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.get("/:id/available-doctors", async (req, res) => {
    try {
      const q = (req.query.q || "").trim();
      const filter = { "hospitals.hospital": { $ne: req.params.id }, isActive: true };
      if (q) {
        const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        filter.$or = [{ firstName: rx }, { lastName: rx }, { uniqueNumber: rx }];
      }
      const doctors = await Doctor.find(filter)
        .select("firstName lastName uniqueNumber")
        .sort({ firstName: 1, lastName: 1 })
        .limit(50);
      res.json(doctors.map((d) => ({
        _id: d._id,
        name: [d.firstName, d.lastName].filter(Boolean).join(" "),
        uniqueNumber: d.uniqueNumber,
      })));
    } catch (err) {
      console.error("get available doctors failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.post("/:id/doctors", async (req, res) => {
    try {
      const { doctorId } = req.body;
      if (!doctorId) return res.status(400).json({ error: "doctorId is required" });
      const doctor = await Doctor.findById(doctorId);
      if (!doctor) return res.status(404).json({ error: "Doctor not found" });
      const already = doctor.hospitals.some((h) => String(h.hospital) === String(req.params.id));
      if (!already) {
        doctor.hospitals.push({ hospital: req.params.id });
        await doctor.save();
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("add doctor to hospital failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.delete("/:id/doctors/:doctorId", async (req, res) => {
    try {
      const doctor = await Doctor.findById(req.params.doctorId);
      if (!doctor) return res.status(404).json({ error: "Doctor not found" });
      doctor.hospitals = doctor.hospitals.filter((h) => String(h.hospital) !== String(req.params.id));
      await doctor.save();
      res.json({ ok: true });
    } catch (err) {
      console.error("remove doctor from hospital failed:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  router.get("/:id", c.getOne);
  router.put("/:id", c.updateOne);
  router.delete("/:id", c.deleteOne);

  return router;
}
