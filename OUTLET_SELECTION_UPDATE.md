# Outlet Selection UI Update - Role-Based Access Control

## Summary
Updated three critical React/Next.js components to implement role-based outlet selection:
- **Stock Adjustment** component
- **Stock Count** component  
- **POS Billing** component

## Implementation Details

### 1. Stock Adjustment Component
**File:** `frontend/src/components/inventory/stock-adjustments-page.jsx`

#### Changes Made:
- Added role detection: `isSuperAdmin` and `isRestrictedRole` checks
- Extracts assigned outlet ID from auth user state: `user?.assignedLocation`
- Auto-selects assigned outlet for restricted roles on component mount
- Stores assigned outlet name for display

#### Conditional Outlet Selection:
```jsx
{isSuperAdmin ? (
  <Select label="Warehouse or outlet" name="warehouseId" value={warehouseId} onChange={(event) => {
    setWarehouseId(event.target.value);
    setLines([]);
    setSearch('');
    setMatches([]);
  }}>
    <option value=""><T>{"Choose a location"}</T></option>
    {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
  </Select>
) : (
  <div>
    <label className="mb-2 block text-sm font-medium text-slate-700"><T>{"Outlet"}</T></label>
    <Badge className="inline-block bg-blue-100 text-blue-800">
      {assignedOutletName || 'Loading...'}
    </Badge>
  </div>
)}
```

#### Key Updates:
- Restricted roles (INVENTORY_MANAGER, CASHIER) see read-only badge
- Badge displays assigned outlet name
- Super Admin users retain full dropdown functionality
- useEffect dependency added: `[..., isRestrictedRole, assignedOutletId]`

---

### 2. Stock Count Component
**File:** `frontend/src/components/inventory/stock-counts-page.jsx`

#### Changes Made:
- Identical role-based logic as Stock Adjustment
- Detects Super Admin vs. restricted roles
- Retrieves assigned outlet from auth state
- Auto-selects and displays assigned outlet

#### Conditional Outlet Selection:
```jsx
{isSuperAdmin ? (
  <Select label="Warehouse or outlet" name="warehouseId" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
    <option value=""><T>{"Choose a location"}</T></option>
    {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
  </Select>
) : (
  <div>
    <label className="mb-2 block text-sm font-medium text-slate-700"><T>{"Outlet"}</T></label>
    <Badge className="inline-block bg-blue-100 text-blue-800">
      {assignedOutletName || 'Loading...'}
    </Badge>
  </div>
)}
```

#### Key Features:
- Restricted users cannot modify outlet selection
- Outlet automatically set on data load
- Graceful loading state handling
- Full dropdown for Super Admin users

---

### 3. POS Billing Component
**File:** `frontend/src/components/pos/pos-billing-page.jsx`

#### Changes Made:
- Added Badge component import: `import { Badge } from '@/components/ui';`
- Implemented role detection for POS outlet display
- Added outlet badge in page header (only for restricted roles)
- Stores assigned outlet information from user auth state

#### Outlet Display in Header:
```jsx
{isRestrictedRole && assignedOutletId && (
  <div className="mt-2">
    <Badge className="inline-block bg-blue-100 text-blue-800">
      Outlet: {assignedOutletName}
    </Badge>
  </div>
)}
```

#### Key Features:
- Badge displays only for INVENTORY_MANAGER and CASHIER roles
- Shows outlet information in prominent header location
- Uses assigned outlet name derived from user object
- Visual indicator: blue badge with blue background
- Non-intrusive for Super Admin users (badge hidden)

---

## State Management Structure

### User Auth State (from Redux):
```javascript
user: {
  id: string,
  name: string,
  email: string,
  role: 'Super Admin' | 'INVENTORY_MANAGER' | 'CASHIER' | ...,
  assignedLocation: string (outlet ID) | null,
  permissions: string[],
  roleId: string
}
```

### Component State Added:
- `isSuperAdmin`: boolean - derived from `user?.role === 'Super Admin'`
- `isRestrictedRole`: boolean - checks if role is INVENTORY_MANAGER or CASHIER
- `assignedOutletId`: string - from `user?.assignedLocation`
- `assignedOutletName`: string - name of assigned outlet (stored after loading)

---

## Styling & UI Conventions

### Badge Component Usage:
```jsx
<Badge className="inline-block bg-blue-100 text-blue-800">
  {text}
</Badge>
```
- **Background:** `bg-blue-100` (light blue)
- **Text:** `text-blue-800` (dark blue)
- **Display:** `inline-block` for proper width handling
- **Tailwind CSS:** Consistent with existing PureBazar design

### Layout Grid:
- Uses `md:grid-cols-2` for responsive layout
- Maintains consistent grid gap: `gap-4`
- Label styling: `text-sm font-medium text-slate-700`

---

## Behavior Summary

| Role | Outlet Selection | Display |
|------|------------------|---------|
| **Super Admin** | Full dropdown | Can select any location |
| **INVENTORY_MANAGER** | Read-only badge | Shows assigned outlet |
| **CASHIER** | Read-only badge | Shows assigned outlet |
| **Other Roles** | Depends on permissions | First available location |

---

## Testing Considerations

### Stock Adjustment Page:
1. Login as Super Admin → Verify full outlet dropdown appears
2. Login as INVENTORY_MANAGER → Verify outlet badge displays (read-only)
3. Verify form submission uses correct outlet ID

### Stock Count Page:
1. Login as Super Admin → Verify full outlet dropdown appears
2. Login as CASHIER → Verify outlet badge displays (read-only)
3. Verify count saving uses correct outlet

### POS Billing Page:
1. Login as Super Admin → Verify no outlet badge in header
2. Login as CASHIER → Verify outlet badge appears in header
3. Verify all transactions use correct outlet

---

## Dependencies & Imports

### Stock Adjustment:
- Uses existing imports: `Badge` from `@/components/ui`
- Selector hooks: `useSelector` from `react-redux`

### Stock Count:
- Uses existing imports: `Badge` from `@/components/ui`
- Same Redux integration as Stock Adjustment

### POS Billing:
- **New Import Added:** `import { Badge } from '@/components/ui';`
- Uses existing auth hook: `useAuth()` from `@/store/use-auth`

---

## Backward Compatibility

✅ **No Breaking Changes**
- Existing functionality preserved for Super Admin users
- Restricted users seamlessly integrate with new UI
- API endpoints unchanged
- All data structures remain compatible
- i18n translation keys reused: `<T>{"..."}</T>`

---

## Future Enhancements

Potential improvements:
- Add outlet name to bill/adjustment receipts
- Audit trail showing which outlet created transaction
- Multi-outlet dashboard view for Super Admin
- Outlet-wise reporting for managers
- Location-based analytics

---

## Commit Message
```
Implement role-based outlet selection in Stock Adjustment, Stock Count, and POS Billing

- Add outlet dropdown for Super Admin users
- Display read-only outlet badge for INVENTORY_MANAGER and CASHIER
- Auto-select assigned outlet on component mount
- Add outlet display in POS header for restricted roles
- Maintain backward compatibility with existing permissions
```
