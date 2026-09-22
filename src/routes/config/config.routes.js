import express from "express";
import PlanConfig from "../../models/PlanConfig.js";
import { getSingleton, updateSingleton } from "../../utils/singletonFactory.js";
import { requireAuth } from "../../middleware/auth.js";

export const planConfigRoutes = express.Router();
planConfigRoutes.use(requireAuth);
planConfigRoutes.get("/", getSingleton(PlanConfig));
planConfigRoutes.put("/", updateSingleton(PlanConfig));
