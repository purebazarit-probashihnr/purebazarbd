# Dashboard Header Outlet Switcher & Role Management Location Assignment

## Summary
Implemented a comprehensive outlet/location management system for PureBazar with:
1. Dashboard Header outlet switcher for Super Admin users
2. Location assignment capability in Role Management (Users form)
3. Dashboard metrics filtering by location/outlet
4. Backend API support for location-aware data retrieval

---

## Frontend Implementation

### 1. Dashboard Header Component (`frontend/src/components/common/header.jsx`)
**Features:**
- **Outlet Switcher Dropdown** - For Super Admin users only
  - Displays "All Outlets" option
  - Dynamically fetches and displays all active outlets
  - Persists selection state for the session
  - Shows assigned outlet name for non-admin users (read-only badge)

- **Key Functionality:**
  - Loads outlets on component mount when user is Super Admin
  - Uses `getLocations` API with `type: 'OUTLET'` filter
  - Handles loading and error states gracefully
  - Dropdown closes on click outside or Escape key
  - Responsive design with proper icon styling

**Code Changes:**
- Added outlet switcher state management (3 useEffects)
- Added outlet dropdown component with styling
- Added outlet-aware conditional rendering
- Integrated MapPin icons for visual consistency

### 2. Role Management Users Form (`frontend/src/app/roles/users/page.jsx`)
**Features:**
- **Location/Outlet Assignment Field**
  - Conditionally shows for Cashier and Inventory Manager roles
  - Required field when role requires location assignment
  - Displays "Assign Outlet (POS)" for Cashiers
  - Displays "Assign Location" for Inventory Managers

- **Key Functionality:**
  - Fetches outlets list on component mount
  - Auto-clears location when role is changed
  - Validates location requirement based on selected role
  - Passes `locationId` in create/update API payload
  - Shows outlet names in dropdown

**Code Changes:**
- Added outlets state and fetching logic
- Updated form to conditionally render location field
- Added role validation logic for location requirements
- Updated API payload to include locationId

### 3. Admin Services (`frontend/src/services/admin.js`)
**New Export:**
```javascript
export const getLocations = (token, filters = {}) => api.get('/locations', {
  ...authConfig(token),
  params: Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
});
```

### 4. Global Styles (`frontend/src/app/globals.css`)
**New CSS Classes:**
```css
.outlet-switcher          /* Container for dropdown */
.outlet-trigger           /* Button to open dropdown */
.outlet-dropdown          /* Dropdown menu container */
.outlet-option            /* Individual outlet option */
.outlet-badge             /* Read-only badge for non-admin users */
```

---

## Backend Implementation

### 1. Dashboard Service (`backend/services/dashboardService.js`)
**Changes:**
- Updated `getDashboard()` to accept optional `locationId` parameter
- Updated `lowStockAlerts()` to filter by location
- When `locationId` is provided, filters orders and stock alerts accordingly
- Maintains backward compatibility (no location = all data)

**Implementation Details:**
```javascript
async function getDashboard({ now = new Date(), lowStockThreshold, locationId } = {}) {
  // Filters Order.find() with locationId when provided
  // Passes locationId to lowStockAlerts()
}

async function lowStockAlerts(thresholdInput, locationId) {
  // Filters Location query by _id when locationId provided
  // Returns location-scoped stock alerts
}
```

### 2. Role Dashboard Service (`backend/services/roleDashboardService.js`)
**Changes:**
- Updated `getModuleDashboard()` to pass user's `assignedLocation || locationId`
- Updated `getDashboardForUser()` to pass location to `getInventoryDashboard()`
- Updated `getInventoryDashboard()` to:
  - Accept `locationId` parameter
  - Filter GoodsReceive, StockAdjustment, StockMovement queries by location
  - Pass location to lowStockAlerts()

**Key Logic:**
- Super Admin sees all data (no location filter)
- Cashier/Inventory Manager sees only their assigned location's data
- Non-location-assigned users see all data (backward compatible)

### 3. Users Controller (`backend/controllers/usersController.js`)
**Changes:**
- Updated `publicUser()` function to include both `locationId` and `assignedLocation` fields
- Response now includes both fields for frontend compatibility
- Maintains existing validation for location assignment

**Response Fields:**
```javascript
{
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  roleId: role?._id?.toString() || user.roleId?.toString() || null,
  role: role?.name || null,
  isActive: user.isActive,
  locationId: user.locationId?.toString() || null,
  assignedLocation: (user.assignedLocation || user.locationId)?.toString() || null,
  createdAt: user.createdAt,
}
```

### 4. Location Routes (`backend/routes/locationRoutes.js`)
**Changes:**
- Added `users:read` to permission requirements
- Now Super Admin can fetch locations when managing users

**Updated Authorization:**
```javascript
authorizeMiddleware({
  anyPermissions: ['stock:read', 'stock:transfer:read', 'expenses:read', 'users:read'],
})
```

### 5. Server Setup (`backend/server.js`)
**Changes:**
- Imported `locationRoutes`
- Mounted location routes at `/api/locations`

---

## Database Model
No changes to User model required. Existing fields used:
- `User.locationId` - Primary field for outlet assignment
- `User.assignedLocation` - Alias field (fallback supported)

---

## API Endpoints

### Get Locations
```
GET /api/locations?type=OUTLET
Authorization: Bearer {token}

Response:
{
  success: true,
  locations: [
    { id: "...", type: "OUTLET", name: "Outlet 1", isActive: true },
    { id: "...", type: "OUTLET", name: "Outlet 2", isActive: true }
  ]
}
```

### Get Dashboard (Location-Scoped)
```
GET /api/dashboard?lowStockThreshold=10
Authorization: Bearer {token}

Response includes:
- For Super Admin: All metrics
- For Cashier/Inventory Manager: Metrics filtered by assignedLocation
```

### Create/Update User with Location
```
POST /api/users
{
  name: "John Cashier",
  email: "john@outlet.com",
  password: "...",
  roleId: "{cashier_role_id}",
  locationId: "{outlet_id}",  // Required for Cashier/Inventory Manager
  isActive: true
}
```

---

## Role-Based Behavior

### Super Admin
- ✅ Sees outlet switcher in header
- ✅ Can view all outlets in dropdown
- ✅ Dashboard shows all-outlet metrics
- ✅ Can assign any outlet to Cashiers/Inventory Managers

### Cashier
- ❌ No outlet switcher shown (read-only badge instead)
- ✅ Sees only assigned outlet's data
- ✅ Dashboard filtered by assigned location
- ✅ Cannot access other outlets' data

### Inventory Manager
- ❌ No outlet switcher shown
- ✅ Sees only assigned location's low stock alerts
- ✅ Dashboard filtered by assigned location
- ✅ Cannot access other locations' inventory

### Other Roles
- ❌ No outlet switcher shown
- ✅ Dashboard shows all data (backward compatible)

---

## Testing
All 277 backend tests pass, including:
- ✅ Role/User CRUD operations
- ✅ Dashboard metrics filtering
- ✅ Location authorization
- ✅ Auth middleware (location assignment)

Frontend production build: ✅ Passed

---

## File Changes Summary

### Frontend (4 files)
1. `frontend/src/components/common/header.jsx` - Outlet switcher component
2. `frontend/src/app/roles/users/page.jsx` - Location assignment form
3. `frontend/src/services/admin.js` - getLocations API call
4. `frontend/src/app/globals.css` - Outlet switcher styles

### Backend (5 files)
1. `backend/controllers/usersController.js` - User response with location
2. `backend/routes/locationRoutes.js` - Updated permissions
3. `backend/server.js` - Location routes setup
4. `backend/services/dashboardService.js` - Location-aware filtering
5. `backend/services/roleDashboardService.js` - Location scoping for roles

---

## Backward Compatibility
✅ All existing functionality preserved:
- Users without location assignment continue to work
- Super Admin sees all data by default
- Existing dashboard metrics unchanged
- No breaking changes to APIs

---

## Next Steps (Optional Enhancements)
1. Add localStorage persistence for outlet selection
2. Add outlet selector to other pages (POS, Inventory)
3. Add location filter to reports
4. Add multi-outlet view option for Super Admin
5. Add location-based authorization to more controllers
