import express from "express";
import Role from "../../models/Role.js";
import Designation from "../../models/Designation.js";
import Section from "../../models/Section.js";
import Group from "../../models/Group.js";
import Region from "../../models/Region.js";
import Employee from "../../models/Employee.js";
import { crud } from "../../utils/crudFactory.js";
import { requireAuth } from "../../middleware/auth.js";

// each is mounted at its own path in app.js:
// /api/admin/roles, /api/admin/designations, etc.

function makeRouter(Model, populate = "") {
  const router = express.Router();
  router.use(requireAuth);
  const c = crud(Model, populate);
  router.get("/", c.getAll);
  router.post("/", c.createOne);
  router.get("/:id", c.getOne);
  router.put("/:id", c.updateOne);
  router.delete("/:id", c.deleteOne);
  return router;
}

export const roleRoutes = makeRouter(Role);
export const designationRoutes = makeRouter(Designation);
export const groupRoutes = makeRouter(Group);
export const regionRoutes = makeRouter(Region);

export const sectionRoutes = makeRouter(Section, "region head");

// bulk import — CSV columns: Section, Region, Employee, Status.
// Region is found-or-created by name; Employee ("head") is matched by
// first+last name against existing employees (not auto-created, since a
// typo'd name would silently create a phantom "employee").
sectionRoutes.post("/bulk-import", async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "rows must be a non-empty array" });
    }

    const regionCache = new Map();
    const allEmployees = await Employee.find().select("firstName lastName");

    function findEmployeeByName(name) {
      const target = name.trim().toLowerCase();
      return allEmployees.find(
        (e) => `${e.firstName} ${e.lastName}`.trim().toLowerCase() === target
      );
    }

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const failedRows = [];
    const createdRegions = [];

    for (const row of rows) {
      const name = (row.name || "").trim();
      const regionName = (row.region || "").trim();
      const employeeName = (row.employee || "").trim();
      const status = (row.status || "").trim().toLowerCase();

      if (!name || !regionName) continue;

      const existing = await Section.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
      if (existing) {
        skipped++;
        continue;
      }

      let regionId;
      const regionKey = regionName.toLowerCase();
      if (regionCache.has(regionKey)) {
        regionId = regionCache.get(regionKey);
      } else {
        const escaped = regionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        let region = await Region.findOne({ name: new RegExp(`^${escaped}$`, "i") });
        if (!region) {
          region = await Region.create({ name: regionName });
          createdRegions.push(regionName);
        }
        regionId = region._id;
        regionCache.set(regionKey, regionId);
      }

      let headId = null;
      if (employeeName) {
        const match = findEmployeeByName(employeeName);
        if (!match) {
          failed++;
          failedRows.push({ name, reason: `No matching employee found: "${employeeName}"` });
          continue;
        }
        headId = match._id;
      }

      await Section.create({
        name,
        region: regionId,
        head: headId,
        isActive: status === "active",
      });
      created++;
    }

    res.json({ created, skipped, failed, failedRows, createdRegions });
  } catch (err) {
    console.error("sections bulk-import failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});
