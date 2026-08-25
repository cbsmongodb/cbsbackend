import express from "express";
import Hospital from "../../models/Hospital.js";
import { crud, exportExcel } from "../../utils/crudFactory.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);

const c = crud(Hospital, "region");
router.get("/", c.getAll);
router.post("/", c.createOne);

router.get(
  "/export",
  exportExcel(
    Hospital,
    [
      { header: "Name", key: "name", width: 28 },
      { header: "Address", key: "address", width: 32 },
      { header: "Phone", key: "phoneNumber", width: 18 },
      { header: "Email", key: "email", width: 24 },
      { header: "Active", key: "isActive", width: 10 },
    ],
    "region"
  )
);

router.get("/:id", c.getOne);
router.put("/:id", c.updateOne);
router.delete("/:id", c.deleteOne);

export default router;
