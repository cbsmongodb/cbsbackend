import express from "express";
import Drug from "../../models/Drug.js";
import ProductType from "../../models/ProductType.js";
import Manufacturer from "../../models/Manufacturer.js";
import ProducingCountry from "../../models/ProducingCountry.js";
import { crud } from "../../utils/crudFactory.js";
import { requireAuth } from "../../middleware/auth.js";

// /api/drugs
const router = express.Router();
router.use(requireAuth);

const drugC = crud(Drug, "productType profile manufacturer producingCountry");
router.get("/", drugC.getAll);
router.post("/", drugC.createOne);
router.get("/:id", drugC.getOne);
router.put("/:id", drugC.updateOne);
router.delete("/:id", drugC.deleteOne);

export default router;

// mounted separately in app.js:
// /api/product-types
export const productTypeRoutes = express.Router();
productTypeRoutes.use(requireAuth);
const ptC = crud(ProductType);
productTypeRoutes.get("/", ptC.getAll);
productTypeRoutes.post("/", ptC.createOne);
productTypeRoutes.get("/:id", ptC.getOne);
productTypeRoutes.put("/:id", ptC.updateOne);
productTypeRoutes.delete("/:id", ptC.deleteOne);

// /api/manufacturers
export const manufacturerRoutes = express.Router();
manufacturerRoutes.use(requireAuth);
const mC = crud(Manufacturer, "country");
manufacturerRoutes.get("/", mC.getAll);
manufacturerRoutes.post("/", mC.createOne);
manufacturerRoutes.get("/:id", mC.getOne);
manufacturerRoutes.put("/:id", mC.updateOne);
manufacturerRoutes.delete("/:id", mC.deleteOne);

// /api/producing-countries
export const producingCountryRoutes = express.Router();
producingCountryRoutes.use(requireAuth);
const pcC = crud(ProducingCountry);
producingCountryRoutes.get("/", pcC.getAll);
producingCountryRoutes.post("/", pcC.createOne);
producingCountryRoutes.get("/:id", pcC.getOne);
producingCountryRoutes.put("/:id", pcC.updateOne);
producingCountryRoutes.delete("/:id", pcC.deleteOne);
