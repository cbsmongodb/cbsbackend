// Usage: router.get('/', requireAuth, requireRole('admin.employees.read'), handler)
//
// Placeholder check — swap the comparison below for whatever permission
// scheme comes over from the Rails app (role names, permission strings,
// a permissions array on Role, etc.).
export function requireRole(...allowedPermissions) {
  return (req, res, next) => {
    const role = req.employee?.role;
    if (!role) return res.status(403).json({ error: "Forbidden" });

    const hasPermission = allowedPermissions.some((p) => role.permissions?.includes(p));
    if (!hasPermission) return res.status(403).json({ error: "Forbidden" });

    next();
  };
}
