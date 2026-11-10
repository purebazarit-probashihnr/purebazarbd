# Role-Based Outlet Selection - Visual Reference Guide

## 1. STOCK ADJUSTMENT COMPONENT

### Before Update:
```
┌─────────────────────────────────────────────┐
│ New adjustment                              │
├─────────────────────────────────────────────┤
│ Warehouse or outlet  │  Adjustment mode     │
│ ┌──────────────────┐ │ ┌──────────────────┐ │
│ │ Choose location  │ │ │ Remove stock   ▼ │ │
│ │ ✓ Warehouse      │ │ └──────────────────┘ │
│ │  Outlet A        │ │                      │
│ │  Outlet B        │ │                      │
│ └──────────────────┘ │                      │
└─────────────────────────────────────────────┘
```

### After Update (Super Admin):
```
┌─────────────────────────────────────────────┐
│ New adjustment                              │
├─────────────────────────────────────────────┤
│ Warehouse or outlet  │  Adjustment mode     │
│ ┌──────────────────┐ │ ┌──────────────────┐ │
│ │ Choose location  │ │ │ Remove stock   ▼ │ │
│ │ ✓ Warehouse      │ │ └──────────────────┘ │
│ │  Outlet A        │ │                      │
│ │  Outlet B        │ │                      │
│ └──────────────────┘ │                      │
└─────────────────────────────────────────────┘
(Same as before - no change for Super Admin)
```

### After Update (Inventory Manager / Cashier):
```
┌─────────────────────────────────────────────┐
│ New adjustment                              │
├─────────────────────────────────────────────┤
│ Outlet               │  Adjustment mode     │
│                      │ ┌──────────────────┐ │
│ ╔══════════════════╗ │ │ Remove stock   ▼ │ │
│ ║ Outlet A         ║ │ └──────────────────┘ │
│ ╚══════════════════╝ │                      │
│ (Read-only badge)    │                      │
│                      │                      │
└─────────────────────────────────────────────┘
(Dropdown replaced with read-only badge)
```

---

## 2. STOCK COUNT COMPONENT

### Before Update:
```
┌─────────────────────────────────────────────┐
│ Start stock count                           │
├─────────────────────────────────────────────┤
│ Warehouse or outlet  │  Count reason        │
│ ┌──────────────────┐ │ ┌──────────────────┐ │
│ │ Choose location  │ │ │ [text input]   │ │
│ │ ✓ Warehouse      │ │ └──────────────────┘ │
│ │  Outlet A        │ │                      │
│ │  Outlet B        │ │                      │
│ └──────────────────┘ │                      │
└─────────────────────────────────────────────┘
```

### After Update (Super Admin):
```
(Unchanged - Same dropdown as before)
```

### After Update (Inventory Manager / Cashier):
```
┌─────────────────────────────────────────────┐
│ Start stock count                           │
├─────────────────────────────────────────────┤
│ Outlet               │  Count reason        │
│                      │ ┌──────────────────┐ │
│ ╔══════════════════╗ │ │ [text input]   │ │
│ ║ Outlet B         ║ │ └──────────────────┘ │
│ ╚══════════════════╝ │                      │
│ (Read-only badge)    │                      │
│                      │                      │
└─────────────────────────────────────────────┘
```

---

## 3. POS BILLING COMPONENT

### Before Update:
```
┌────────────────────────────────────────────┐
│ Sales                      [Hold Sale] [📋] │
│ Point of Sale                              │
│ Scan items, apply discounts, complete bill │
├────────────────────────────────────────────┤
│ Item Scanner                               │
├────────────────────────────────────────────┤
│ Cart                                       │
│                                            │
└────────────────────────────────────────────┘
```

### After Update (Super Admin):
```
┌────────────────────────────────────────────┐
│ Sales                      [Hold Sale] [📋] │
│ Point of Sale                              │
│ Scan items, apply discounts, complete bill │
├────────────────────────────────────────────┤
│ (No outlet badge - works across all)       │
│ Item Scanner                               │
├────────────────────────────────────────────┤
│ Cart                                       │
│                                            │
└────────────────────────────────────────────┘
```

### After Update (Cashier):
```
┌────────────────────────────────────────────┐
│ Sales                      [Hold Sale] [📋] │
│ Point of Sale                              │
│ Scan items, apply discounts, complete bill │
│ ╔══════════════════════════════════════╗   │
│ ║ Outlet: John's Outlet                ║   │
│ ╚══════════════════════════════════════╝   │
├────────────────────────────────────────────┤
│ Item Scanner                               │
├────────────────────────────────────────────┤
│ Cart                                       │
│                                            │
└────────────────────────────────────────────┘
```

---

## Role Behavior Matrix

```
┌──────────────────┬──────────────────────┬──────────────┬──────────────────┐
│ Role             │ Stock Adjustment     │ Stock Count  │ POS Billing      │
├──────────────────┼──────────────────────┼──────────────┼──────────────────┤
│ Super Admin      │ Dropdown ✓           │ Dropdown ✓   │ No badge         │
│                  │ Select any location  │ Select any   │ Works everywhere │
├──────────────────┼──────────────────────┼──────────────┼──────────────────┤
│ INVENTORY        │ Read-only badge ✓    │ Read-only    │ Badge visible    │
│ MANAGER          │ Auto-selected        │ badge        │ Auto-selected    │
│                  │ Cannot change        │ Auto-select  │ Cannot change    │
├──────────────────┼──────────────────────┼──────────────┼──────────────────┤
│ CASHIER          │ Read-only badge ✓    │ Read-only    │ Badge visible    │
│                  │ Auto-selected        │ badge        │ Auto-selected    │
│                  │ Cannot change        │ Auto-select  │ Cannot change    │
└──────────────────┴──────────────────────┴──────────────┴──────────────────┘
```

---

## Color Scheme

### Badge Styling:
- **Background:** Light Blue (`bg-blue-100`)
- **Text Color:** Dark Blue (`text-blue-800`)
- **Border:** None (flat design)
- **Padding:** Consistent with other badges (Tailwind default)

### Example Badge HTML:
```jsx
<Badge className="inline-block bg-blue-100 text-blue-800">
  Outlet: Outlet A
</Badge>
```

### Rendered:
```
╔════════════════════╗
║ Outlet: Outlet A   ║  ← Blue text on light blue background
╚════════════════════╝
```

---

## State Flow Diagram

### Super Admin:
```
┌─────────────────────────────────────┐
│ Component Mount                     │
│ - Load all locations                │
│ - isSuperAdmin = true               │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ Render Full Dropdown                │
│ - Show all locations                │
│ - User can select any location      │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ Submit Action                       │
│ - Use selected location             │
│ - Process normally                  │
└─────────────────────────────────────┘
```

### Restricted Role (INVENTORY_MANAGER / CASHIER):
```
┌─────────────────────────────────────┐
│ Component Mount                     │
│ - Load all locations                │
│ - isSuperAdmin = false              │
│ - isRestrictedRole = true           │
│ - assignedOutletId = "outlet_123"   │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ Process Assigned Outlet             │
│ - Find assigned outlet in list      │
│ - setAssignedOutletName()           │
│ - setWarehouseId(assignedOutletId)  │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ Render Read-Only Badge              │
│ - Display outlet name               │
│ - No dropdown/selection allowed     │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│ Submit Action                       │
│ - Use auto-selected location        │
│ - Process normally                  │
└─────────────────────────────────────┘
```

---

## Code Examples

### Role Detection (All Components):
```javascript
const isSuperAdmin = user?.role === 'Super Admin';
const isRestrictedRole = ['INVENTORY_MANAGER', 'CASHIER'].includes(user?.role);
const assignedOutletId = user?.assignedLocation;
```

### Dynamic Outlet Selection:
```javascript
if (isRestrictedRole && assignedOutletId) {
  const assigned = availableLocations.find((loc) => loc.id === assignedOutletId);
  setAssignedOutletName(assigned?.name || '');
  setWarehouseId(assignedOutletId);
} else {
  setWarehouseId(availableLocations[0]?.id || '');
}
```

### Conditional Rendering:
```jsx
{isSuperAdmin ? (
  // Full dropdown for Super Admin
  <Select {...props}>
    {locations.map((location) => (
      <option key={location.id} value={location.id}>
        {location.name}
      </option>
    ))}
  </Select>
) : (
  // Read-only badge for restricted roles
  <Badge className="inline-block bg-blue-100 text-blue-800">
    {assignedOutletName || 'Loading...'}
  </Badge>
)}
```

---

## User Experience Timeline

### Super Admin Flow:
1. Login as Super Admin
2. Navigate to Stock Adjustment
3. See full outlet dropdown
4. Select desired outlet
5. Proceed with adjustment

### INVENTORY_MANAGER Flow:
1. Login as INVENTORY_MANAGER
2. Navigate to Stock Adjustment
3. See read-only badge: "Outlet: Main Warehouse"
4. Proceed with adjustment (pre-scoped to their outlet)
5. Submit - automatically uses their outlet

### CASHIER Flow:
1. Login as CASHIER
2. Navigate to POS Billing
3. See outlet badge in header: "Outlet: Outlet A"
4. Scan items and complete billing
5. All transactions tied to their outlet automatically
