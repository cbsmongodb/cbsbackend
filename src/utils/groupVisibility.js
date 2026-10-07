import Section from "../models/Section.js";
import Group from "../models/Group.js";
import Employee from "../models/Employee.js";

// Which Group documents `requester` is allowed to see, based on the
// Section/Group head hierarchy:
//   - a Section's head sees every Group listed in that Section's `groups`
//   - a Group's own head sees just that one Group
//   - everyone else sees no groups (their own baseline data only)
// these roles only ever see their OWN data (attendance, reports...), even if
// they happen to be set as head of a group or section
const SELF_ONLY_ROLES = new Set(["sales manager"]);

export async function getVisibleGroups(requester) {
  if (SELF_ONLY_ROLES.has((requester?.role?.name || "").toLowerCase().trim())) return [];
  // 1) Section head -> every group of that section (both link directions,
  //    in case Section.groups[] or Group.section is missing on one side)
  const section = await Section.findOne({ head: requester._id }).populate("groups");
  if (section) {
    const byId = new Map();
    (section.groups || []).forEach((g) => byId.set(String(g._id), g));
    const linked = await Group.find({ section: section._id });
    linked.forEach((g) => byId.set(String(g._id), g));
    if (byId.size > 0) return Array.from(byId.values());
  }

  // 2) Division Manager role who isn't set as Section.head -> the whole
  //    division their own group belongs to
  const roleName = (requester?.role?.name || "").toLowerCase().trim();
  if (roleName === "division manager" && requester.group) {
    const own = await Group.findById(requester.group).select("section");
    if (own?.section) {
      const divisionGroups = await Group.find({ section: own.section });
      if (divisionGroups.length > 0) return divisionGroups;
    }
  }

  const ownGroups = await Group.find({ head: requester._id });
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
]);

export function seesEverything(requester) {
  const name = (requester?.role?.name || "").toLowerCase().trim();
  return GLOBAL_ROLES.has(name);
}

// Central scoping helper. Returns:
//   null  -> sees everyone (admin/director/finance/office manager) — do not filter
//   [ids] -> restrict to exactly these employee IDs (division/group manager)
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

  const memberEmployees = await Employee.find({ group: { $in: groupIds } }).select("_id");
  memberEmployees.forEach((e) => ids.add(String(e._id)));

  return Array.from(ids);
}

// Drug IDs this requester is allowed to see — union of their group(s)'
// drug lists. Section/Group heads see every drug across their visible
// groups; a regular member sees just their own group's drugs (found via
// their own Employee.group field, not the mostly-empty Group.members[]);
// someone with no group at all sees none.
export async function getVisibleDrugIds(requester) {
  const headGroups = await getVisibleGroups(requester);
  if (headGroups.length > 0) {
    const ids = new Set();
    headGroups.forEach((g) => (g.drugs || []).forEach((d) => ids.add(String(d))));
    return Array.from(ids);
  }

  if (requester.group) {
    const memberGroup = await Group.findById(requester.group);
    if (memberGroup) {
      return (memberGroup.drugs || []).map(String);
    }
  }

  return [];
}
