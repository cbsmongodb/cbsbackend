import express from "express";
import {
  getAllDoctors,
  getDoctor,
  createDoctor,
  updateDoctor,
  deleteDoctor,
} from "./doctors.controller.js";
import { crud } from "../../utils/crudFactory.js";
import DoctorCategory from "../../models/DoctorCategory.js";
import DoctorSubcategory from "../../models/DoctorSubcategory.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

// /api/doctors
router.get("/", getAllDoctors);
router.post("/", createDoctor);
router.get("/:id", getDoctor);
router.put("/:id", updateDoctor);
router.delete("/:id", deleteDoctor);

export default router;

// separate sub-routers, mounted in app.js at their own paths:
// /api/doctor-categories, /api/doctor-subcategories
export const doctorCategoryRoutes = express.Router();
doctorCategoryRoutes.use(requireAuth);
const catC = crud(DoctorCategory);
doctorCategoryRoutes.get("/", catC.getAll);
doctorCategoryRoutes.post("/", catC.createOne);
doctorCategoryRoutes.get("/:id", catC.getOne);
doctorCategoryRoutes.put("/:id", catC.updateOne);
doctorCategoryRoutes.delete("/:id", catC.deleteOne);

export const doctorSubcategoryRoutes = express.Router();
doctorSubcategoryRoutes.use(requireAuth);
const subC = crud(DoctorSubcategory);
doctorSubcategoryRoutes.get("/", subC.getAll);
doctorSubcategoryRoutes.post("/", subC.createOne);
doctorSubcategoryRoutes.get("/:id", subC.getOne);
doctorSubcategoryRoutes.put("/:id", subC.updateOne);
doctorSubcategoryRoutes.delete("/:id", subC.deleteOne);
