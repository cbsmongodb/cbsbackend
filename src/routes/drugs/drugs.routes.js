import express from "express";
import Drug from "../../models/Drug.js";
import ProductType from "../../models/ProductType.js";
import Manufacturer from "../../models/Manufacturer.js";
import ProducingCountry from "../../models/ProducingCountry.js";
import { crud, exportExcel } from "../../utils/crudFactory.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

const drugC = crud(Drug, "productType profiles manufacturers");
router.get("/", drugC.getAll);
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
