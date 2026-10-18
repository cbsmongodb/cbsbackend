import express from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  getMine, getRestDaysForYear, createRequest, cancelRequest,
  getPending, approveRequest, rejectRequest, getArchive,
} from "./leaveRequests.controller.js";

// everyone can request their own leave; approve / reject / archive are checked inside
const router = express.Router();
router.use(requireAuth);
router.get("/mine", getMine);
router.get("/rest-days", getRestDaysForYear);
router.get("/pending", getPending);
router.get("/archive", getArchive);
router.post("/", createRequest);
router.post("/:id/approve", approveRequest);
router.post("/:id/reject", rejectRequest);
router.delete("/:id", cancelRequest);
export default router;
