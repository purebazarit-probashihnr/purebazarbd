# Dashboard Outlet Switcher & Location Assignment - Usage Guide

## For Super Admin Users

### Using the Outlet Switcher in Dashboard Header

1. **Access the Dashboard**
   - Navigate to `/dashboard`
   - As a Super Admin, you'll see the outlet switcher in the header

2. **View/Switch Outlets**
   - Click the outlet switcher button showing "All Outlets" or current selection
   - A dropdown menu opens showing:
     - "All Outlets" (default)
     - List of all active outlets with their names
   - Click an outlet to filter dashboard data to that location only
   - Click "All Outlets" to see data from all outlets

3. **Dashboard Updates Automatically**
   - When you select an outlet, all dashboard metrics update immediately:
     - Today's Sales
     - Bill Count
     - Payment methods breakdown
     - Low stock alerts (for that outlet only)
     - Pending GRNs
     - Stock adjustments
     - Fast-moving products (for that outlet)

4. **Selection Persists**
   - Your outlet selection stays active while you're viewing the dashboard
   - Resets to "All Outlets" on page refresh (intended behavior)

---

## Assigning Locations to Users

### Creating a New Cashier/Inventory Manager

1. **Open Users Management**
   - Go to `/roles/users`
   - Click "Add user" button

2. **Fill in User Details**
   - Full name (e.g., "John Cashier")
   - Email address (e.g., john@store.com)
   - Password (minimum 8 characters)
   - Select role: "Cashier" or "Outlet Cashier" or "Inventory Manager"

3. **Assign an Outlet/Location**
   - For Cashier roles: "Assign Outlet (POS)" field appears
   - For Inventory Manager: "Assign Location" field appears
   - This field is REQUIRED
   - Click dropdown to select outlet
   - Choose the outlet where this user will work

4. **Save User**
   - Click "Save user" button
   - User is created with assigned outlet
   - Only that outlet's data will be visible to this user

### Editing User's Location Assignment

1. **Open Users Management**
   - Go to `/roles/users`
   - Find the user in the list
   - Click the pencil (edit) icon

2. **Update Location**
   - Scroll to "Assign Outlet" or "Assign Location" field
   - Select a different outlet if needed
   - Leave unchanged to keep current assignment

3. **Save Changes**
   - Click "Save user" button
   - Changes applied immediately
   - User's dashboard will show new location's data next login

---

## For Cashier Users

### Dashboard View

1. **No Outlet Switcher**
   - You won't see the outlet switcher dropdown
   - Instead, you see an outlet badge in the header showing your assigned location

2. **Dashboard Shows Only Your Outlet Data**
   - All metrics (sales, bills, payments, stock) are automatically filtered to your outlet only
   - You cannot view other outlets' data
   - This is for data security and focus

3. **POS Sales**
   - All your POS sales are recorded for your assigned outlet
   - You can only process sales at your assigned location

---

## For Inventory Manager Users

### Dashboard View

1. **No Outlet Switcher**
   - You only see a badge showing your assigned location
   - Cannot switch between outlets

2. **Inventory Metrics Filtered**
   - Low stock alerts show only products low on stock in your location
   - Pending GRNs show only deliveries for your warehouse
   - Stock adjustments show only changes in your location
   - Cannot see other locations' inventory data

3. **Stock Transfers**
   - Can initiate transfers from your location to other locations
   - Can receive transfers to your location

---

## Technical Details for Developers

### Frontend

#### Header Component Usage
```jsx
import Header from '@/components/common/header';

// In app shell
<Header section="Dashboard" onMenuClick={handleMenuClick} />

// Outlet switcher appears automatically for Super Admin
// Non-admin users see outlet badge instead
```

#### Location Assignment in Forms
```jsx
// Form automatically shows location field for:
// - Role: "Cashier" or "Outlet Cashier"
// - Role: "Inventory Manager"

// Location field is required when role requires it
// Clears when role changes to non-location role
```

### Backend

#### Dashboard Filtering
```javascript
// Automatic location filtering in getDashboardForUser()
// Super Admin: No filter applied
// Cashier/Inventory Manager: Filtered by assignedLocation

// Usage in dashboard route:
const dashboard = await getDashboardForUser(req.user, {
  lowStockThreshold: req.query.lowStockThreshold
});
```

#### API Response
```json
{
  "user": {
    "id": "...",
    "name": "John Cashier",
    "role": "Outlet Cashier",
    "locationId": "outlet_123",
    "assignedLocation": "outlet_123",
    "permissions": [...]
  }
}
```

---

## Troubleshooting

### Outlet Switcher Not Showing
- **Issue**: You don't see the outlet switcher dropdown
- **Solution**: Check if you're logged in as Super Admin
- **Check**: Go to your user menu to verify your role

### Location Field Not Showing
- **Issue**: Can't see location field when creating/editing user
- **Solution**: Confirm the selected role is Cashier or Inventory Manager
- **Note**: Other roles don't require location assignment

### Dashboard Shows No Data
- **Issue**: Dashboard appears empty after outlet selection
- **Solution**: 
  1. Refresh the page
  2. Check if there's actually data for that outlet
  3. Verify your permissions include "dashboard:read"

### Cannot Select Outlet for Cashier
- **Issue**: Location field is disabled or empty
- **Solution**: 
  1. Ensure at least one active POS outlet exists
  2. Check that outlets are marked as active in system settings
  3. Refresh the page to reload outlet list

### User Sees Wrong Outlet
- **Issue**: User sees data from wrong location
- **Solution**:
  1. Verify the user's assigned location in Users management
  2. Ask user to refresh their browser/logout and login again
  3. Check if user's role changed (check Role → Manage page)

---

## Security Notes

- ✅ Cashiers cannot see other outlets' data
- ✅ Inventory Managers cannot see other locations' inventory
- ✅ Only Super Admin can assign locations to users
- ✅ Location assignments are validated at backend level
- ✅ All queries are filtered server-side (not just frontend hiding)
- ✅ Changing user's location immediately restricts their data access

---

## Best Practices

1. **Always Assign Locations**
   - For Cashier and Inventory Manager roles, always select an outlet
   - Don't leave the location field empty
   - Reassign if the user transfers to another outlet

2. **Use Descriptive Outlet Names**
   - Use clear names like "Main Store", "Downtown", "Mall Outlet"
   - Avoid generic names like "Store 1", "Store 2"
   - Makes it easier for Super Admin to track

3. **Monitor Dashboard Access**
   - Regularly review who has access to which outlets
   - Audit user location assignments quarterly
   - Update when staff transfers between locations

4. **Test After Assignment**
   - After assigning a user to a location, ask them to verify
   - Check that they only see their location's data
   - Confirm they cannot access other outlets

---

## Summary

The outlet switcher and location assignment system provides:
- 🎯 Centralized outlet management for Super Admin
- 🔒 Data isolation for role-based users
- 📊 Location-scoped dashboards
- 🛡️ Security and access control
- 📱 Clean, intuitive user interface
