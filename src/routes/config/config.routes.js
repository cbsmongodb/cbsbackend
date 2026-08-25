import express from "express";
import PlanConfig from "../../models/PlanConfig.js";
import NotificationConfig from "../../models/NotificationConfig.js";
import BatchConfig from "../../models/BatchConfig.js";
import { getSingleton, updateSingleton } from "../../utils/singletonFactory.js";
import { requireAuth } from "../../middleware/auth.js";

export const planConfigRoutes = express.Router();
planConfigRoutes.use(requireAuth);
planConfigRoutes.get("/", getSingleton(PlanConfig));
planConfigRoutes.put("/", updateSingleton(PlanConfig));

export const notificationConfigRoutes = express.Router();
notificationConfigRoutes.use(requireAuth);
notificationConfigRoutes.get("/", getSingleton(NotificationConfig));
notificationConfigRoutes.put("/", updateSingleton(NotificationConfig));

export const batchConfigRoutes = express.Router();
batchConfigRoutes.use(requireAuth);
batchConfigRoutes.get("/", getSingleton(BatchConfig));
batchConfigRoutes.put("/", updateSingleton(BatchConfig));
