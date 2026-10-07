import Role from "../models/Role.js";
import Employee from "../models/Employee.js";
import Section from "../models/Section.js";
import LeaveEntry from "../models/LeaveEntry.js";
import { getVisibleGroups, getVisibleEmployeeIds, getScopeEmployeeIds } from "../utils/groupVisibility.js";

// Division Manager / Group Manager are "scoped managers": every admin list
// they open is limited to their own division (or group), and every write
// is checked so they can't touch people/groups outside it.
const SCOPED_ROLES = new Set(["division manager", "group manager"]);

// roles a scoped manager may never hand out (would let them escalate
// themselves or someone else to see everything)
const PROTECTED_ROLES = [
  "admin",
  "director",
  "system administrator",
  "finance manager",
  "office manager",
  "division manager",
  "accountant's assistant",
  "accountant’s assistant",
];
export const PROTECTED_ROLE_REGEXES = PROTECTED_ROLES.map((n) => new RegExp(`^\\s*${n}\\s*$`, "i"));

const forbid = (res, msg = "Forbidden") => res.status(403).json({ error: msg });
const firstSegment = (req) => req.path.split("/").filter(Boolean)[0] || null;
const toId = (v) => (v && typeof v === "object" && v._id ? String(v._id) : v ? String(v) : "");

export function isScopedManager(employee) {
  return SCOPED_ROLES.has((employee?.role?.name || "").toLowerCase().trim());
}

// ids of the sections / groups / regions this manager is allowed to see
export async function getManagerScope(employee) {
  const groups = await getVisibleGroups(employee);
  const groupIds = new Set();
  const sectionIds = new Set();
  const regionIds = new Set();
  groups.forEach((g) => {
    groupIds.add(String(g._id));
    if (g.section) sectionIds.add(toId(g.section));
    if (g.region) regionIds.add(toId(g.region));
  });
  const headed = await Section.find({ head: employee._id }).select("_id region");
  headed.forEach((s) => {
    sectionIds.add(String(s._id));
    if (s.region) regionIds.add(toId(s.region));
  });
  return {
    groupIds: [...groupIds],
    sectionIds: [...sectionIds],
    regionIds: [...regionIds],
  };
}

// /api/admin/sections | groups | regions
//   GET list  -> filtered to own division
//   GET :id   -> 403 if outside division
//   writes    -> only groups, only inside own division; sections/regions read-only
export function adminScope(kind) {
  const key = { section: "sectionIds", group: "groupIds", region: "regionIds" }[kind];
  return async (req, res, next) => {
    try {
      if (!isScopedManager(req.employee)) return next();
      const scope = await getManagerScope(req.employee);
      const allowed = scope[key];
      const id = firstSegment(req);

      if (req.method === "GET") {
        if (!id) {
          req.scopeFilter = { _id: { $in: allowed } };
          return next();
        }
        return allowed.includes(id) ? next() : forbid(res, "ეს ჩანაწერი სხვა დივიზიონს ეკუთვნის");
      }

      if (kind !== "group") return forbid(res, "ამის შეცვლის უფლება არ გაქვთ");
      if (req.method === "POST" && id) return forbid(res, "ამის შეცვლის უფლება არ გაქვთ");
      if (id && !allowed.includes(id)) return forbid(res, "ეს ჯგუფი სხვა დივიზიონს ეკუთვნის");

      const section = req.body?.section;
      const sectionEmpty = section === undefined || section === null || section === "";
      if (req.method === "POST" && sectionEmpty) {
        return res.status(400).json({ error: "აირჩიეთ დივიზიონი (Section)" });
      }
      if (req.method === "PUT" && (section === null || section === "")) {
        return forbid(res, "ჯგუფს დივიზიონს ვერ მოაშორებთ");
      }
      if (!sectionEmpty && !scope.sectionIds.includes(toId(section))) {
        return forbid(res, "ჯგუფს მხოლოდ თქვენს დივიზიონში დაამატებთ");
      }
      next();
    } catch (err) {
      console.error(`adminScope(${kind}) failed:`, err);
      res.status(500).json({ error: "Server error" });
    }
  };
}

// /api/admin/roles — a scoped manager only gets the role list (for the
// employee form dropdown), without roles they aren't allowed to assign
export function rolesScope(req, res, next) {
  if (!isScopedManager(req.employee)) return next();
  if (req.method === "GET" && !firstSegment(req)) {
    req.scopeFilter = { name: { $nin: PROTECTED_ROLE_REGEXES } };
    return next();
  }
  return forbid(res);
}

// /api/employees — reads are already scoped in the controller; here we
// guard writes: only own people, only own groups, no protected roles
export async function employeeScope(req, res, next) {
  try {
    if (!isScopedManager(req.employee)) return next();
    if (req.method === "GET") return next();

    const id = firstSegment(req);
    if (id === "bulk-import") return forbid(res, "იმპორტის უფლება არ გაქვთ");

    const visible = (await getVisibleEmployeeIds(req.employee)).map(String);
    if (id && !visible.includes(id)) return forbid(res, "ეს თანამშრომელი სხვა დივიზიონშია");

    const body = req.body || {};

    if (body.role) {
      const target = id ? await Employee.findById(id).select("role") : null;
      const unchanged = target && String(target.role) === toId(body.role);
      if (!unchanged) {
        const role = await Role.findById(toId(body.role)).select("name");
        if (!role) return res.status(400).json({ error: "როლი ვერ მოიძებნა" });
        if (PROTECTED_ROLE_REGEXES.some((r) => r.test(role.name))) {
          return forbid(res, "ამ როლის მინიჭების უფლება არ გაქვთ");
        }
      }
    }

    const group = body.group;
    const groupEmpty = group === undefined || group === null || group === "";
    if (req.method === "POST" && groupEmpty) {
      return res.status(400).json({ error: "აირჩიეთ ჯგუფი" });
    }
    if (!groupEmpty) {
      const scope = await getManagerScope(req.employee);
      if (!scope.groupIds.includes(toId(group))) {
        return forbid(res, "თანამშრომელს მხოლოდ თქვენი დივიზიონის ჯგუფში დაამატებთ");
      }
    }
    next();
  } catch (err) {
    console.error("employeeScope failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}

// /api/leaves — only own people's leaves; company rest-days stay read-only
export async function leaveScope(req, res, next) {
  try {
    if (!isScopedManager(req.employee)) {
      // the leave list is limited to the people this role can see
      // (company-wide roles and admin get everything)
      if (req.method === "GET" && !firstSegment(req)) {
        const ids = await getScopeEmployeeIds(req.employee);
        if (ids) req.scopeEmployeeIds = ids.map(String);
      }
      return next();
    }
    const seg = firstSegment(req);

    if (seg === "rest-days") {
      return req.method === "GET" ? next() : forbid(res, "დასვენების დღეებს მხოლოდ ადმინისტრაცია ცვლის");
    }

    const visible = (await getVisibleEmployeeIds(req.employee)).map(String);

    if (req.method === "GET") {
      const emp = req.query.employee;
      if (emp && !visible.includes(String(emp))) return forbid(res);
      req.scopeEmployeeIds = visible;
      return next();
    }

    if (req.method === "POST") {
      const emp = toId(req.body?.employee);
      if (emp && !visible.includes(emp)) return forbid(res, "ეს თანამშრომელი სხვა დივიზიონშია");
      return next();
    }

    if (req.method === "DELETE" && seg) {
      const entry = await LeaveEntry.findById(seg).select("employee");
      if (entry && !visible.includes(String(entry.employee))) return forbid(res);
      return next();
    }

    next();
  } catch (err) {
    console.error("leaveScope failed:", err);
    res.status(500).json({ error: "Server error" });
  }
}
