import express from "express";
import Role from "../../models/Role.js";
import Designation from "../../models/Designation.js";
import Section from "../../models/Section.js";
import Group from "../../models/Group.js";
import Region from "../../models/Region.js";
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
export const sectionRoutes = makeRouter(Section);
export const groupRoutes = makeRouter(Group);
export const regionRoutes = makeRouter(Region);
