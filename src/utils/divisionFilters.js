// Division / group filters shared by the report pages.
//   peopleOf(section, group)   -> employee ids of that group / division (+ division head), or null when no filter
//   filtersFor(scopeIds|null)  -> { sections, groups } this user may see (each group with its employee ids)
import Employee from "../models/Employee.js";
import Group from "../models/Group.js";
import Section from "../models/Section.js";

const okId = (v) => /^[a-f0-9]{24}$/i.test(String(v || ""));

export async function peopleOf(section, group) {
  let groupIds = [];
  let head = null;
  if (okId(group)) groupIds = [String(group)];
  else if (okId(section)) {
    const sec = await Section.findById(section).select("groups head").lean();
    const linked = await Group.find({ section }).distinct("_id");
    groupIds = [...new Set([...(sec?.groups || []).map(String), ...linked.map(String)])];
    head = sec?.head ? String(sec.head) : null;
  } else return null;
  const ids = new Set(head ? [head] : []);
  (await Employee.find({ group: { $in: groupIds } }).distinct("_id")).forEach((id) => ids.add(String(id)));
  (await Group.find({ _id: { $in: groupIds } }).select("head members").lean()).forEach((g) => {
    if (g.head) ids.add(String(g.head));
    (g.members || []).forEach((m) => ids.add(String(m)));
  });
  return [...ids];
}

export async function filtersFor(scope) {
  const allowed = scope ? new Set(scope.map(String)) : null;
  const [sections, groups, people] = await Promise.all([
    Section.find().select("name groups head").sort({ name: 1 }).lean(),
    Group.find().select("name section head members").sort({ name: 1 }).lean(),
    Employee.find(allowed ? { _id: { $in: [...allowed] } } : {}).select("group").lean(),
  ]);
  const sectionOf = new Map();
  sections.forEach((s) => (s.groups || []).forEach((g) => sectionOf.set(String(g), String(s._id))));
  const byGroup = new Map();
  const add = (g, e) => {
    if (!g || !e || (allowed && !allowed.has(String(e)))) return;
    if (!byGroup.has(String(g))) byGroup.set(String(g), new Set());
    byGroup.get(String(g)).add(String(e));
  };
  people.forEach((p) => add(p.group, p._id));
  groups.forEach((g) => { add(g._id, g.head); (g.members || []).forEach((m) => add(g._id, m)); });
  const outGroups = groups.filter((g) => byGroup.has(String(g._id))).map((g) => ({
    id: String(g._id), name: g.name,
    section: g.section ? String(g.section) : sectionOf.get(String(g._id)) || null,
    employees: [...byGroup.get(String(g._id))],
  }));
  const used = new Set(outGroups.map((g) => g.section).filter(Boolean));
  return {
    sections: sections.filter((s) => used.has(String(s._id))).map((s) => ({ id: String(s._id), name: s.name, head: s.head ? String(s.head) : null })),
    groups: outGroups,
  };
}

// narrow a filter field (single id / { $in } / empty) to `only`
export function narrowTo(cur, only) {
  const set = new Set(only.map(String));
  if (cur && typeof cur !== "object") return set.has(String(cur)) ? cur : { $in: [] };
  if (cur?.$in) return { $in: cur.$in.filter((id) => set.has(String(id))) };
  return { $in: only };
}
