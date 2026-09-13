import express from "express";
import Drug from "../../models/Drug.js";
import ProductType from "../../models/ProductType.js";
import Manufacturer from "../../models/Manufacturer.js";
import ProducingCountry from "../../models/ProducingCountry.js";
import Profile from "../../models/Profile.js";
import { crud, exportExcel } from "../../utils/crudFactory.js";
import { getVisibleDrugIds } from "../../utils/groupVisibility.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

const drugC = crud(Drug, "productType profiles manufacturers");

// custom getAll (not the generic crudFactory one) — needs group-based
// visibility scoping that no other crudFactory resource needs
async function getAllDrugs(req, res) {
  try {
    const { page, limit, search } = req.query;

    const filter = {};
    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.name = new RegExp(escaped, "i");
    }

    const isAdmin = req.employee?.role?.name?.toLowerCase() === "admin";
    if (!isAdmin) {
      const visibleIds = await getVisibleDrugIds(req.employee);
      filter._id = { $in: visibleIds };
    }

    const populate = "productType profiles manufacturers";

    if (!page && !limit) {
      const docs = await Drug.find(filter).populate(populate).sort({ createdAt: -1 });
      return res.json(docs);
    }

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
    const skip = (pageNum - 1) * limitNum;

    const [docs, total] = await Promise.all([
      Drug.find(filter).populate(populate).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      Drug.countDocuments(filter),
    ]);

    res.json({
      docs,
      total,
      page: pageNum,
      pages: Math.max(Math.ceil(total / limitNum), 1),
      limit: limitNum,
    });
  } catch (err) {
    console.error("getAllDrugs failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

router.get("/", getAllDrugs);
router.post("/", drugC.createOne);

router.get(
  "/export",
  exportExcel(
    Drug,
    [
      { header: "Name", key: "name", width: 28 },
      { header: "Price", key: "price", width: 12 },
      { header: "Stock", key: "stocks", width: 12 },
      { header: "Bonus", key: "bonus", width: 12 },
      { header: "Monthly Target", key: "monthlyTarget", width: 16 },
      { header: "Active", key: "isActive", width: 10 },
      { header: "Expired", key: "expired", width: 10 },
    ],
    "productType manufacturers"
  )
);

router.post("/bulk-import", async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "rows must be a non-empty array" });
    }

    const productTypeCache = new Map();
    const profileCache = new Map();
    const countryCache = new Map();
    const manufacturerCache = new Map();

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const createdEntities = { productTypes: [], profiles: [], countries: [], manufacturers: [] };
    const failedRows = [];

    async function findOrCreate(Model, cache, name, extraFields = {}) {
      const trimmed = (name || "").trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      if (cache.has(key)) return cache.get(key);

      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      let doc = await Model.findOne({ name: new RegExp(`^${escaped}$`, "i") });
      let wasCreated = false;
      if (!doc) {
        doc = await Model.create({ name: trimmed, ...extraFields });
        wasCreated = true;
      }
      cache.set(key, doc._id);
      return { id: doc._id, wasCreated };
    }

    for (const row of rows) {
      const name = (row.name || "").trim();
      if (!name) continue;

      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const existing = await Drug.findOne({ name: new RegExp(`^${escapedName}$`, "i") });
      if (existing) {
        skipped++;
        continue;
      }

      const productTypeName = (row.productType || "").trim();
      if (!productTypeName) {
        failed++;
        failedRows.push({ name, reason: "Product type is missing" });
        continue;
      }

      let productTypeId;
      {
        const key = productTypeName.toLowerCase();
        if (productTypeCache.has(key)) {
          productTypeId = productTypeCache.get(key);
        } else {
          const escaped = productTypeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          let pt = await ProductType.findOne({ name: new RegExp(`^${escaped}$`, "i") });
          if (!pt) {
            pt = await ProductType.create({ name: productTypeName });
            createdEntities.productTypes.push(productTypeName);
          }
          productTypeId = pt._id;
          productTypeCache.set(key, productTypeId);
        }
      }

      let profileId = null;
      const profileName = (row.profile || "").trim();
      if (profileName) {
        const key = profileName.toLowerCase();
        if (profileCache.has(key)) {
          profileId = profileCache.get(key);
        } else {
          const escaped = profileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          let pr = await Profile.findOne({ name: new RegExp(`^${escaped}$`, "i") });
          if (!pr) {
            pr = await Profile.create({ name: profileName });
            createdEntities.profiles.push(profileName);
          }
          profileId = pr._id;
          profileCache.set(key, profileId);
        }
      }

      let countryId = null;
      const countryName = (row.country || "").trim();
      if (countryName) {
        const key = countryName.toLowerCase();
        if (countryCache.has(key)) {
          countryId = countryCache.get(key);
        } else {
          const escaped = countryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          let c = await ProducingCountry.findOne({ name: new RegExp(`^${escaped}$`, "i") });
          if (!c) {
            c = await ProducingCountry.create({ name: countryName });
            createdEntities.countries.push(countryName);
          }
          countryId = c._id;
          countryCache.set(key, countryId);
        }
      }

      let manufacturerId = null;
      const manufacturerName = (row.manufacturer || "").trim();
      if (manufacturerName) {
        const key = manufacturerName.toLowerCase();
        if (manufacturerCache.has(key)) {
          manufacturerId = manufacturerCache.get(key);
        } else {
          const escaped = manufacturerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          let m = await Manufacturer.findOne({ name: new RegExp(`^${escaped}$`, "i") });
          if (!m) {
            m = await Manufacturer.create({
              name: manufacturerName,
              producingCountry: countryId || null,
            });
            createdEntities.manufacturers.push(manufacturerName);
          }
          manufacturerId = m._id;
          manufacturerCache.set(key, manufacturerId);
        }
      }

      await Drug.create({
        name,
        productType: productTypeId,
        profiles: profileId ? [profileId] : [],
        manufacturers: manufacturerId ? [manufacturerId] : [],
        generalDescription: (row.generalDescription || "").trim(),
        inputComponent: (row.inputComponent || "").trim(),
        isActive: true,
      });
      created++;
    }

    res.json({ created, skipped, failed, failedRows, createdEntities });
  } catch (err) {
    console.error("bulk-import drugs failed:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:id", drugC.getOne);
router.put("/:id", drugC.updateOne);
router.delete("/:id", drugC.deleteOne);

export default router;

export const productTypeRoutes = express.Router();
productTypeRoutes.use(requireAuth);
const ptC = crud(ProductType);
productTypeRoutes.get("/", ptC.getAll);
productTypeRoutes.post("/", ptC.createOne);
productTypeRoutes.get("/:id", ptC.getOne);
productTypeRoutes.put("/:id", ptC.updateOne);
productTypeRoutes.delete("/:id", ptC.deleteOne);

export const manufacturerRoutes = express.Router();
manufacturerRoutes.use(requireAuth);
const mC = crud(Manufacturer, "producingCountry");
manufacturerRoutes.get("/", mC.getAll);
manufacturerRoutes.post("/", mC.createOne);
manufacturerRoutes.get("/:id", mC.getOne);
manufacturerRoutes.put("/:id", mC.updateOne);
manufacturerRoutes.delete("/:id", mC.deleteOne);

export const producingCountryRoutes = express.Router();
producingCountryRoutes.use(requireAuth);
const pcC = crud(ProducingCountry);
producingCountryRoutes.get("/", pcC.getAll);
producingCountryRoutes.post("/", pcC.createOne);
producingCountryRoutes.get("/:id", pcC.getOne);
producingCountryRoutes.put("/:id", pcC.updateOne);
producingCountryRoutes.delete("/:id", pcC.deleteOne);
