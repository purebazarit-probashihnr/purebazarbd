/**
 * Middleware to enforce location scope based on user role
 * - SUPER_ADMIN: Can optionally select a specific outlet via 'selectedOutletId' query param
 * - INVENTORY_MANAGER/CASHIER: Strictly scoped to their assignedLocation
 */
function enforceLocationScope(req, res, next) {
  if (!req.user) {
    const error = new Error('User authentication required');
    error.status = 401;
    return next(error);
  }

  const userRole = req.user.role;
  const assignedLocation = req.user.assignedLocation;

  // SUPER_ADMIN: optional location override via selectedOutletId
  if (userRole === 'SUPER_ADMIN') {
    const selectedOutletId = req.query.selectedOutletId;
    if (selectedOutletId) {
      req.query.locationId = selectedOutletId;
    }
    return next();
  }

  // INVENTORY_MANAGER and CASHIER: strictly enforce assigned location
  if (userRole === 'INVENTORY_MANAGER' || userRole === 'CASHIER') {
    if (!assignedLocation) {
      const error = new Error('Assigned location is not set for this user');
      error.status = 403;
      return next(error);
    }

    // Override query and body parameters with assigned location
    req.query.locationId = assignedLocation;
    if (req.body) {
      req.body.locationId = assignedLocation;
    }
    return next();
  }

  // For other roles, allow the request to proceed without modification
  return next();
}

module.exports = enforceLocationScope;
