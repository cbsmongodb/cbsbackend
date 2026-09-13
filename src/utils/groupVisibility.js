import Section from "../models/Section.js";
import Group from "../models/Group.js";

// Which Group documents `requester` is allowed to see, based on the
// Section/Group head hierarchy:
//   - a Section's head sees every Group listed in that Section's `groups`
//   - a Group's own head sees just that one Group
//   - everyone else sees no groups (their own baseline data only)
export async function getVisibleGroups(requester) {
  const section = await Section.findOne({ head: requester._id }).populate("groups");
  if (section && section.groups?.length > 0) {
    return section.groups;
  }

  const ownGroups = await Group.find({ head: requester._id });
  if (ownGroups.length > 0) {
    return ownGroups;
  }

  return [];
}

// Employee IDs this requester is allowed to see in employee lists —
// the union of all their visible groups' members and heads, plus themselves.
export async function getVisibleEmployeeIds(requester) {
  const groups = await getVisibleGroups(requester);
  if (groups.length === 0) {
    return [requester._id];
  }

  const ids = new Set([String(requester._id)]);
  groups.forEach((g) => {
    if (g.head) ids.add(String(g.head));
    (g.members || []).forEach((m) => ids.add(String(m)));
  });
  return Array.from(ids);
}
