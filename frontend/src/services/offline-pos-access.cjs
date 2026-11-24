function locationIdOf(location) {
  return String(location?._id || location?.id || location || '').trim();
}

function isOfflinePosUser(user) {
  if (!user) return false;
  const role = String(user.role || user.roleId?.name || '').trim();
  const roleKey = role.toLowerCase();
  const isSuperAdmin = role === 'Super Admin' || user.permissions?.includes('*');
  if (isSuperAdmin || user.canViewAllLocations === true) return false;

  const outletRoles = roleKey === 'cashier'
    || roleKey === 'outlet cashier'
    || roleKey === 'outlet manager';
  if (!outletRoles) return false;

  const locationId = locationIdOf(user.locationId);
  if (!locationId) return false;
  if (user.location?.type && String(user.location.type).toUpperCase() !== 'OUTLET') return false;
  if (typeof user.locationId === 'object'
    && user.locationId?.type
    && String(user.locationId.type).toUpperCase() !== 'OUTLET') return false;
  return true;
}

module.exports = { isOfflinePosUser };
