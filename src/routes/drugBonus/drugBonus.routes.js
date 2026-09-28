import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import { listByDrug, upsertBonus, deleteBonus } from "./drugBonus.controller.js";

const router = express.Router();
router.use(requireAuth);

router.get("/", listByDrug);
router.post("/", upsertBonus);
router.delete("/:id", deleteBonus);

export default router;
