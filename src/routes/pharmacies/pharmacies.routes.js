import express from "express";
import Pharmacy from "../../models/Pharmacy.js";
import { crud } from "../../utils/crudFactory.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

const c = crud(Pharmacy, "region");
router.get("/", c.getAll);
router.post("/", c.createOne);
router.get("/:id", c.getOne);
router.put("/:id", c.updateOne);
router.delete("/:id", c.deleteOne);

export default router;
