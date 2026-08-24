# Backend structure

```
src/
  config/
    db.js               ← mongoose connection

  models/                ← every schema, all in one place
    Employee.js
    Role.js / Designation.js / Section.js / Group.js / Region.js / Division.js
    Doctor.js / DoctorCategory.js / DoctorSubcategory.js
    Hospital.js / Pharmacy.js / Profile.js
    Drug.js / ProductType.js / Manufacturer.js / ProducingCountry.js
    SalesEntry.js
    Attendance.js
    Planning.js / Task.js

  routes/                ← one folder per resource — routes + controller together
    auth/
    employees/
    doctors/              (also exports doctor-categories / doctor-subcategories routers)
    hospitals/
    pharmacies/
    profiles/
    drugs/                 (also exports product-types / manufacturers / producing-countries)
    sales/
    attendance/            (needs `io`, exported as a function — see app.js)
    planAndPerform/
    reports/
    admin/                  (roles, designations, sections, groups, regions)
    divisions/

  middleware/
    auth.js               ← requireAuth — verifies JWT, attaches req.employee
    requireRole.js         ← requireRole('permission.name') — placeholder, wire up
                              real permissions once they're ported from Rails

  utils/
    crudFactory.js         ← generic getAll/getOne/create/update/delete used by
                              every simple lookup-table resource (product types,
                              manufacturers, hospitals, roles, etc.) — resources
                              with real logic (attendance, sales, employees, auth)
                              get their own controller instead

  sockets/
    liveFeed.socket.js     ← socket.io connection handling

  app.js                  ← express app, every router mounted here
  server.js               ← entry point: connects DB, starts http+socket.io server
```

## Running locally

```bash
cd server
npm install
cp .env.example .env   # fill in MONGO_URI, JWT_SECRET, CLIENT_URL
npm run dev
```

## Deploying on Render

- Create a **Web Service** (not a Cron Job / Background Worker) — this keeps
  the process alive 24/7, which Socket.io needs for the Live Feed to push
  updates in real time.
- Build command: `npm install`
- Start command: `npm start`
- Add the same env vars from `.env.example` in Render's dashboard.
- Set `CLIENT_URL` to your deployed Next.js URL (needed for CORS + the
  socket.io handshake).

## What's still a placeholder

- `middleware/requireRole.js` — permission check is a stub; wire in the
  real role/permission rules once you share the Rails logic.
- `reports/reports.controller.js` — `getEfficiencyReport` is a best-guess
  aggregation; `getReimbursementReport` is empty. Both need the exact
  calculation rules from the Rails app.
- Every model has a minimal set of fields based on what showed up in the
  screenshots/descriptions — add whatever's missing once you're working
  from the real Rails schema.

## Adding a new simple resource

Most "list All / Status / Actions" screens (like Product Types) are three
lines with the CRUD factory:

```js
import express from "express";
import MyModel from "../../models/MyModel.js";
import { crud } from "../../utils/crudFactory.js";
import { requireAuth } from "../../middleware/auth.js";

const router = express.Router();
router.use(requireAuth);
const c = crud(MyModel);
router.get("/", c.getAll);
router.post("/", c.createOne);
router.get("/:id", c.getOne);
router.put("/:id", c.updateOne);
router.delete("/:id", c.deleteOne);
export default router;
```

Then mount it in `app.js` at whatever path it needs.
