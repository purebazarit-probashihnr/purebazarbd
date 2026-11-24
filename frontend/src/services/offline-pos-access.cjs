function locationIdOf(location) {
  return String(location?._id || location?.id || location || '').trim();
}

function isOfflinePosUser(user) {
  if (!user) return false;
  const role = String(user.role || user.roleId?.name || '').trim();
  if (role === 'Super Admin'
    || user.canViewAllLocations === true
    || user.roleId?.canViewAllLocations === true) return false;
  const permissions = Array.isArray(user.permissions)
    ? user.permissions
    : Array.isArray(user.roleId?.permissions) ? user.roleId.permissions : [];
  if (!permissions.some((permission) => [
    '*', 'pos:read', 'pos.sales:read', 'pos.sales:write',
  ].includes(permission))) return false;

  const assignedLocationLists = [
    user.locationIds,
    user.locations,
    user.assignedLocations,
  ].filter(Array.isArray);
  if (assignedLocationLists.some((locations) => locations.length !== 1)) return false;
  const locationId = locationIdOf(user.locationId);
  if (!locationId) return false;
  if (assignedLocationLists.some((locations) => locationIdOf(locations[0]) !== locationId)) {
    return false;
  }
  const locationType = user.location?.type || user.locationId?.type;
  if (String(locationType || '').toUpperCase() !== 'OUTLET') return false;
  return true;
}

module.exports = { isOfflinePosUser };
