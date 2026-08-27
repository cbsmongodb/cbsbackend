import express from "express";
import Hospital from "../../models/Hospital.js";
import Region from "../../models/Region.js";
import { crud, exportExcel } from "../../utils/crudFactory.js";
import { requireAuth } from "../../middleware/auth.js";
import { geocodeAddress } from "../../utils/geocode.js";

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

  router.get("/:id", c.getOne);
  router.put("/:id", c.updateOne);
  router.delete("/:id", c.deleteOne);

  return router;
}
