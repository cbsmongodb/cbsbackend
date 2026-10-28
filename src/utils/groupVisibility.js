import Section from "../models/Section.js";
import Group from "../models/Group.js";
import Employee from "../models/Employee.js";
import { createCache } from "./cacheBus.js";

// visibility rarely changes — cache per user for 60s; any write to
// Employee / Group / Section / Role clears it instantly (cacheBus)
const groupsCache = createCache(60_000);
const employeeIdsCache = createCache(60_000);
const drugIdsCache = createCache(60_000);
const scopeKey = (r) => `${r?._id}|${r?.role?.name || ""}|${r?.group || ""}`;

// Which Group documents `requester` is allowed to see, based on the
// Section/Group head hierarchy:
//   - a Section's head sees every Group listed in that Section's `groups`
//   - a Group's own head sees just that one Group
//   - everyone else sees no groups (their own baseline data only)
// these roles only ever see their OWN data (attendance, reports...), even if
// they happen to be set as head of a group or section
const SELF_ONLY_ROLES = new Set([
  "sales manager",
  "aesthetics team",
  "head pharmacist",
  "warehouse manager",
  "accounts and logistics",
  "regulatory",
]);

export async function getVisibleGroups(requester) {
  const groups = await groupsCache(scopeKey(requester), () => computeVisibleGroups(requester));
  return [...groups];
}

async function computeVisibleGroups(requester) {
  if (SELF_ONLY_ROLES.has((requester?.role?.name || "").toLowerCase().trim())) return [];
  // 1) Section head -> every group of that section (both link directions,
  //    in case Section.groups[] or Group.section is missing on one side)
  const section = await Section.findOne({ head: requester._id }).populate("groups").lean();
  if (section) {
    const byId = new Map();
    (section.groups || []).forEach((g) => byId.set(String(g._id), g));
    const linked = await Group.find({ section: section._id }).lean();
    linked.forEach((g) => byId.set(String(g._id), g));
    if (byId.size > 0) return Array.from(byId.values());
  }

  // 2) Division Manager role who isn't set as Section.head -> the whole
  //    division their own group belongs to
  const roleName = (requester?.role?.name || "").toLowerCase().trim();
  const DIVISION_WIDE_ROLES = ["division manager", "product manager"];
  if (DIVISION_WIDE_ROLES.includes(roleName) && requester.group) {
    const own = await Group.findById(requester.group).select("section").lean();
    if (own?.section) {
      const divisionGroups = await Group.find({ section: own.section }).lean();
      if (divisionGroups.length > 0) return divisionGroups;
    }
  }

  const ownGroups = await Group.find({ head: requester._id }).lean();
  if (ownGroups.length > 0) {
    return ownGroups;
  }

  return [];
}

// Exactly these roles see everyone's data (no scoping). Everyone else —
// including Division Manager and Group Manager — is scoped to their own people.
const GLOBAL_ROLES = new Set([
  "admin",
  "director",
  "system administrator",
  "finance manager",
  "office manager",
  "accountant's assistant",
  "accountant’s assistant",
  "office",
]);

export function seesEverything(requester) {
  const name = (requester?.role?.name || "").toLowerCase().trim();
  return GLOBAL_ROLES.has(name);
}

// Central scoping helper. Returns:
//   null  -> sees everyone (admin/director/finance/office manager) — do not filter
//   [ids] -> restrict to exactly these employee IDs (division/group manager)
// true if this requester may see / change records of that employee
// (admin, director, finance... -> everyone; managers -> their people; others -> themselves)
export async function canSeeEmployee(requester, employeeId) {
  const scope = await getScopeEmployeeIds(requester);
  if (!scope) return true;
  const target = String(employeeId?._id || employeeId || "");
  return scope.some((id) => String(id) === target);
}

// narrows a Mongo filter's "employee" field to the requester's scope
export async function applyEmployeeScope(requester, filter, field = "employee") {
  const scope = await getScopeEmployeeIds(requester);
  if (!scope) return filter;
  const allowed = new Set(scope.map(String));
  if (filter[field] && typeof filter[field] !== "object") {
    if (!allowed.has(String(filter[field]))) filter[field] = { $in: [] };
  } else {
    filter[field] = { $in: scope };
  }
  return filter;
}

export async function getScopeEmployeeIds(requester) {
  if (seesEverything(requester)) return null;
  return getVisibleEmployeeIds(requester);
}

// Employee IDs this requester is allowed to see in employee lists —
// the union of all their visible groups' members and heads, plus themselves.
//
// Group.members[] is basically never populated in the real data — the
// actual membership signal lives on Employee.group (set for every real
// employee via setEmployeeDivisionsGroups.js). We check both: Group.members
// in case it's ever manually maintained via the Groups admin page, and a
// direct Employee.find({ group: ... }) so real members aren't silently
// missed just because the mirror array was never filled in.
export async function getVisibleEmployeeIds(requester) {
  const ids = await employeeIdsCache(scopeKey(requester), () => computeVisibleEmployeeIds(requester));
  return [...ids];
}

async function computeVisibleEmployeeIds(requester) {
  const groups = await getVisibleGroups(requester);
  if (groups.length === 0) {
    return [requester._id];
  }

  const groupIds = groups.map((g) => g._id);
  const ids = new Set([String(requester._id)]);
  groups.forEach((g) => {
    if (g.head) ids.add(String(g.head));
    (g.members || []).forEach((m) => ids.add(String(m)));
  });

  const memberEmployees = await Employee.find({ group: { $in: groupIds } }).select("_id").lean();
  memberEmployees.forEach((e) => ids.add(String(e._id)));

  return Array.from(ids);
}

// Drug IDs this requester is allowed to see — union of their group(s)'
// drug lists. Section/Group heads see every drug across their visible
// groups; a regular member sees just their own group's drugs (found via
// their own Employee.group field, not the mostly-empty Group.members[]);
// someone with no group at all sees none.
export async function getVisibleDrugIds(requester) {
  const ids = await drugIdsCache(scopeKey(requester), () => computeVisibleDrugIds(requester));
  return [...ids];
}

async function computeVisibleDrugIds(requester) {
  // union of: groups they lead + their own group's drugs too (Employee.group)
  // + any group that lists them in members[] — a rep who is also set as head
  // of some group, or is listed only in members[], still sees their group
  const ids = new Set();
  const add = (g) => (g?.drugs || []).forEach((d) => ids.add(String(d)));
  (await getVisibleGroups(requester)).forEach(add);
  const or = [{ members: requester._id }];
  if (requester.group) or.push({ _id: requester.group?._id || requester.group });
  (await Group.find({ $or: or }).select("drugs").lean()).forEach(add);
  return Array.from(ids);
}
