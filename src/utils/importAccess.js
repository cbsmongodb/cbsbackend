// who may open the drug / hospital IMPORT pages: admin, director and
// Tea Kobelashvili only — regardless of what the Roles page says
const ROLES = new Set(["admin", "director"]);
// first name Tea / თეა + last name Kobelashvili / ქობელაშვილი
const FIRST = new Set(["tea", "თეა"]);
const LAST = /^(kobelashvili|ქობელაშვილი)$/;

export function canImport(emp) {
  if (!emp) return false;
  const role = (emp.role?.name || "").toLowerCase().trim();
  if (ROLES.has(role)) return true;
  const words = [emp.firstName, emp.lastName, emp.name].filter(Boolean)
    .join(" ").toLowerCase().split(/\s+/);
  return words.some((w) => FIRST.has(w)) && words.some((w) => LAST.test(w));
}

export function importOnly(req, res, next) {
  if (canImport(req.employee)) return next();
  return res.status(403).json({ error: "იმპორტის უფლება არ გაქვთ" });
}
