# Code Changes Summary - Outlet Selection Implementation

## File 1: Stock Adjustments Page
**Path:** `frontend/src/components/inventory/stock-adjustments-page.jsx`

### Change 1: Add Role Detection in Component
**Location:** Line ~23 (in component function)

```javascript
// ADDED - Role and outlet detection
const isSuperAdmin = user?.role === 'Super Admin';
const isRestrictedRole = ['INVENTORY_MANAGER', 'CASHIER'].includes(user?.role);
const assignedOutletId = user?.assignedLocation;
const [assignedOutletName, setAssignedOutletName] = useState('');
```

### Change 2: Update useEffect to Auto-Select Outlet
**Location:** Line ~53-66 (in locations loading useEffect)

```javascript
// BEFORE:
const availableLocations = locationResponse.data.locations.filter((item) => item.isActive !== false);
setLocations(availableLocations);
setWarehouseId(availableLocations[0]?.id || '');

// AFTER:
const availableLocations = locationResponse.data.locations.filter((item) => item.isActive !== false);
setLocations(availableLocations);

if (isRestrictedRole && assignedOutletId) {
  const assigned = availableLocations.find((loc) => loc.id === assignedOutletId);
  setAssignedOutletName(assigned?.name || '');
  setWarehouseId(assignedOutletId);
} else {
  setWarehouseId(availableLocations[0]?.id || '');
}
```

### Change 3: Update useEffect Dependencies
**Location:** Line ~66 (dependency array)

```javascript
// BEFORE:
}, [canRead, initialized, permissions, token]);

// AFTER:
}, [canRead, initialized, permissions, token, isRestrictedRole, assignedOutletId]);
```

### Change 4: Replace Outlet Dropdown with Conditional Render
**Location:** Line ~250 (in form JSX)

```javascript
// BEFORE:
<Select label="Warehouse or outlet" name="warehouseId" value={warehouseId} onChange={(event) => {
  setWarehouseId(event.target.value);
  setLines([]);
  setSearch('');
  setMatches([]);
}}>
  <option value=""><T>{"Choose a location"}</T></option>
  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
</Select>

// AFTER:
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

---

## File 2: Stock Counts Page
**Path:** `frontend/src/components/inventory/stock-counts-page.jsx`

### Change 1: Add Role Detection in Component
**Location:** Line ~29 (in component function)

```javascript
// ADDED - Role and outlet detection
const isSuperAdmin = user?.role === 'Super Admin';
const isRestrictedRole = ['INVENTORY_MANAGER', 'CASHIER'].includes(user?.role);
const assignedOutletId = user?.assignedLocation;
const [assignedOutletName, setAssignedOutletName] = useState('');
```

### Change 2: Update useEffect to Auto-Select Outlet
**Location:** Line ~52-65 (in locations loading useEffect)

```javascript
// BEFORE:
const availableLocations = locationResponse.data.locations.filter((item) => item.isActive !== false);
setLocations(availableLocations);
setWarehouseId(availableLocations[0]?.id || '');

// AFTER:
const availableLocations = locationResponse.data.locations.filter((item) => item.isActive !== false);
setLocations(availableLocations);

if (isRestrictedRole && assignedOutletId) {
  const assigned = availableLocations.find((loc) => loc.id === assignedOutletId);
  setAssignedOutletName(assigned?.name || '');
  setWarehouseId(assignedOutletId);
} else {
  setWarehouseId(availableLocations[0]?.id || '');
}
```

### Change 3: Update useEffect Dependencies
**Location:** Line ~65 (dependency array)

```javascript
// BEFORE:
}, [canRead, initialized, permissions, token]);

// AFTER:
}, [canRead, initialized, permissions, token, isRestrictedRole, assignedOutletId]);
```

### Change 4: Replace Outlet Dropdown with Conditional Render
**Location:** Line ~203 (in form JSX)

```javascript
// BEFORE:
<Select label="Warehouse or outlet" name="warehouseId" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
  <option value=""><T>{"Choose a location"}</T></option>
  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
</Select>

// AFTER:
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

---

## File 3: POS Billing Page
**Path:** `frontend/src/components/pos/pos-billing-page.jsx`

### Change 1: Add Badge Import
**Location:** Line ~3-4 (imports section)

```javascript
// BEFORE:
import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import useAuth from '@/store/use-auth';

// AFTER:
import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { Badge } from '@/components/ui';
import useAuth from '@/store/use-auth';
```

### Change 2: Add Role Detection in Component
**Location:** Line ~33-36 (in component function)

```javascript
// ADDED - Role and outlet detection
const isSuperAdmin = user?.role === 'Super Admin';
const isRestrictedRole = ['INVENTORY_MANAGER', 'CASHIER'].includes(user?.role);
const assignedOutletId = user?.assignedLocation;
const assignedOutletName = user?.name ? `${user.name}'s Outlet` : 'Assigned Outlet';
```

### Change 3: Add Outlet Badge to Header
**Location:** Line ~283-290 (in header JSX)

```javascript
// BEFORE:
<div>
  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500"><T>{"Sales"}</T></p>
  <h1 className="text-2xl font-semibold text-slate-900"><T>{"Point of Sale"}</T></h1>
  <p className="mt-1 text-sm text-slate-600"><T>{"Scan items, apply permitted discounts, and complete a bill."}</T></p>
</div>

// AFTER:
<div>
  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500"><T>{"Sales"}</T></p>
  <h1 className="text-2xl font-semibold text-slate-900"><T>{"Point of Sale"}</T></h1>
  <p className="mt-1 text-sm text-slate-600"><T>{"Scan items, apply permitted discounts, and complete a bill."}</T></p>
  {isRestrictedRole && assignedOutletId && (
    <div className="mt-2">
      <Badge className="inline-block bg-blue-100 text-blue-800">
        Outlet: {assignedOutletName}
      </Badge>
    </div>
  )}
</div>
```

---

## Key Points for Implementation

### 1. Badge Component Already Imported
- Stock Adjustment: ✓ Already imports Badge
- Stock Count: ✓ Already imports Badge
- POS Billing: ✗ **NEW IMPORT REQUIRED** - Add `Badge` to imports

### 2. Role Detection Logic
All three files use identical role detection:
```javascript
const isSuperAdmin = user?.role === 'Super Admin';
const isRestrictedRole = ['INVENTORY_MANAGER', 'CASHIER'].includes(user?.role);
const assignedOutletId = user?.assignedLocation;
```

### 3. Auto-Selection Logic
All three files use identical auto-selection:
```javascript
if (isRestrictedRole && assignedOutletId) {
  const assigned = availableLocations.find((loc) => loc.id === assignedOutletId);
  setAssignedOutletName(assigned?.name || '');
  setWarehouseId(assignedOutletId);
} else {
  setWarehouseId(availableLocations[0]?.id || '');
}
```

### 4. Conditional Rendering Pattern
All three files use similar conditional rendering:
```jsx
{isSuperAdmin ? (
  <Select ...>{...}</Select>
) : (
  <Badge>...</Badge>
)}
```

### 5. Badge Styling (Consistent)
```jsx
<Badge className="inline-block bg-blue-100 text-blue-800">
  {text}
</Badge>
```

---

## Validation Checklist

- [ ] Badge component imported in POS Billing page
- [ ] Role detection logic added to all three components
- [ ] Auto-selection logic implemented
- [ ] Conditional rendering replaces outlet dropdown
- [ ] useEffect dependencies updated (add `isRestrictedRole, assignedOutletId`)
- [ ] Badge styling matches design system
- [ ] No TypeScript/ESLint errors
- [ ] Backward compatibility maintained
- [ ] Super Admin dropdown still functional
- [ ] Restricted roles show read-only badge

---

## Testing Commands

### Build Check:
```bash
npm run build
```

### Linting:
```bash
npm run lint
```

### Run Development:
```bash
npm run dev
```

### Test with Different Roles:
1. **Super Admin:** Login with Super Admin account → Verify dropdown
2. **INVENTORY_MANAGER:** Login → Verify badge displays
3. **CASHIER:** Login → Verify badge displays and POS shows outlet

---

## Rollback Instructions

If needed to revert changes:

### For Stock Adjustment & Stock Count:
Remove the conditional render and replace with simple Select:
```jsx
<Select label="Warehouse or outlet" name="warehouseId" value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
  <option value=""><T>{"Choose a location"}</T></option>
  {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
</Select>
```

### For POS Billing:
Remove Badge import and outlet badge from header:
```javascript
// Remove:
import { Badge } from '@/components/ui';

// Remove:
{isRestrictedRole && assignedOutletId && (
  <div className="mt-2">
    <Badge className="inline-block bg-blue-100 text-blue-800">
      Outlet: {assignedOutletName}
    </Badge>
  </div>
)}
```

---

## Related Files (No Changes Required)
- `backend/controllers/authController.js` - Already returns `assignedLocation`
- `frontend/src/store/auth-slice.js` - Already stores user data
- `frontend/src/store/use-auth.js` - Already exports user object
- All API endpoints remain unchanged
- Database models remain unchanged
