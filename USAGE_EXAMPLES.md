# Role-Based Outlet Selection - Usage Examples

## Real-World Scenarios

### Scenario 1: Multi-Outlet Super Admin Managing Inventory

**User:** Ahmed (Super Admin)  
**Locations:** Central Warehouse, Dhanmondi Outlet, Gulshan Outlet

```jsx
// Ahmed logs in → Auth state:
{
  role: 'Super Admin',
  assignedLocation: null,  // Super Admin not assigned to specific outlet
  permissions: ['*'],
  name: 'Ahmed'
}

// Component detects:
isSuperAdmin = true
isRestrictedRole = false

// UI Result:
Stock Adjustment Page
├─ "Warehouse or outlet" dropdown → VISIBLE ✓
│  ├─ Central Warehouse
│  ├─ Dhanmondi Outlet
│  └─ Gulshan Outlet
│
└─ Ahmed can select any location
   Adjusts stock for Central Warehouse

Stock Count Page
├─ "Warehouse or outlet" dropdown → VISIBLE ✓
│  └─ Same options
│
└─ Ahmed starts count at Dhanmondi Outlet

POS Billing Page
├─ No outlet badge → HIDDEN ✓
└─ Cashier for any outlet can use system
```

---

### Scenario 2: INVENTORY_MANAGER at Single Outlet

**User:** Fatima (INVENTORY_MANAGER)  
**Assigned Location:** Gulshan Outlet

```jsx
// Fatima logs in → Auth state:
{
  role: 'INVENTORY_MANAGER',
  assignedLocation: '507f1f77bcf86cd799439011',  // Gulshan Outlet ID
  permissions: ['stock:read', 'stock:write', 'products:read'],
  name: 'Fatima'
}

// Component detects:
isSuperAdmin = false
isRestrictedRole = true
assignedOutletId = '507f1f77bcf86cd799439011'

// Component auto-selects:
const availableLocations = [
  { id: '507f1f77bcf86cd799439011', name: 'Gulshan Outlet' },
  { id: '507f1f77bcf86cd799439012', name: 'Dhanmondi Outlet' }
]

const assigned = availableLocations.find(
  (loc) => loc.id === '507f1f77bcf86cd799439011'
)
setAssignedOutletName('Gulshan Outlet')
setWarehouseId('507f1f77bcf86cd799439011')

// UI Result:
Stock Adjustment Page
├─ Outlet (read-only)
│  ╔══════════════════╗
│  ║ Gulshan Outlet   ║
│  ╚══════════════════╝
│
└─ Form submission automatically uses:
   warehouseId = '507f1f77bcf86cd799439011'

Stock Count Page
├─ Outlet (read-only)
│  ╔══════════════════╗
│  ║ Gulshan Outlet   ║
│  ╚══════════════════╝
│
└─ Count automatically scoped to Gulshan Outlet

POS Billing Page
├─ No outlet display (she's not a cashier)
└─ If she has pos:write permission:
   Header shows:
   ┌─────────────────────────────────┐
   │ Sales                           │
   │ Point of Sale                   │
   │ ╔══════════════════════════════╗│
   │ ║ Outlet: Gulshan Outlet       ║│
   │ ╚══════════════════════════════╝│
   └─────────────────────────────────┘
```

---

### Scenario 3: CASHIER at Till Point

**User:** Karim (CASHIER)  
**Assigned Location:** Dhanmondi Outlet

```jsx
// Karim logs in → Auth state:
{
  role: 'CASHIER',
  assignedLocation: '507f1f77bcf86cd799439012',  // Dhanmondi Outlet ID
  permissions: ['pos:read', 'pos:write', 'products:read'],
  name: 'Karim'
}

// Component detects (POS Billing):
isSuperAdmin = false
isRestrictedRole = true
assignedOutletId = '507f1f77bcf86cd799439012'
assignedOutletName = "Karim's Outlet" // Or store name from location

// POS Page renders:
┌─────────────────────────────────────────────────┐
│ Sales                                           │
│ Point of Sale                                   │
│ Scan items, apply permitted discounts, bill     │
│ ╔════════════════════════════════════════════╗  │
│ ║ Outlet: Dhanmondi Outlet                   ║  │
│ ╚════════════════════════════════════════════╝  │
│                                                 │
│ [Hold Sale Button] [📋 Held Bills Button]      │
├─────────────────────────────────────────────────┤
│ Item Scanner Interface                          │
├─────────────────────────────────────────────────┤
│ Cart: [Product 1] [Product 2] [...]            │
└─────────────────────────────────────────────────┘

// When Karim sells:
1. Scans items
2. Adds to cart
3. Completes payment
4. System automatically assigns:
   - outlet = '507f1f77bcf86cd799439012' (Dhanmondi)
   - cashier = 'karim_user_id'
   - timestamp = now
   
5. Order saved to database with location scoped

// Stock movements created:
StockMovement {
  type: 'SALE',
  warehouseId: '507f1f77bcf86cd799439012',
  productId: [...],
  quantity: -N,
  reference: 'ORDER_ID'
}
```

---

### Scenario 4: Multiple Cashiers at Same Outlet

**Location:** Gulshan Outlet

**Cashier 1:**
```jsx
{
  role: 'CASHIER',
  assignedLocation: '507f1f77bcf86cd799439011',
  name: 'Rania'
}

// POS Header:
╔════════════════════════════════╗
║ Outlet: Gulshan Outlet         ║
╚════════════════════════════════╝
```

**Cashier 2:**
```jsx
{
  role: 'CASHIER',
  assignedLocation: '507f1f77bcf86cd799439011',  // Same outlet
  name: 'Samina'
}

// POS Header:
╔════════════════════════════════╗
║ Outlet: Gulshan Outlet         ║
╚════════════════════════════════╝
```

Both cashiers see same outlet badge because they're assigned to same location.
All their sales are aggregated under Gulshan Outlet.

---

## Code Execution Flow Examples

### Example 1: Stock Adjustment Form Submission

```javascript
// Initial state when component mounts
const user = {
  role: 'INVENTORY_MANAGER',
  assignedLocation: '507f1f77bcf86cd799439011',
  name: 'Fatima'
}

// 1. Component initialization
const isSuperAdmin = user?.role === 'Super Admin'  // false
const isRestrictedRole = ['INVENTORY_MANAGER', 'CASHIER'].includes(user?.role)  // true
const assignedOutletId = user?.assignedLocation  // '507f1f77bcf86cd799439011'

// 2. In useEffect - Load locations
getLocations(token).then(response => {
  const availableLocations = response.data.locations
  setLocations(availableLocations)
  
  // 3. Auto-select logic
  if (isRestrictedRole && assignedOutletId) {
    const assigned = availableLocations.find(
      (loc) => loc.id === assignedOutletId
    )
    // found: { id: '507f1f77bcf86cd799439011', name: 'Gulshan Outlet' }
    
    setAssignedOutletName('Gulshan Outlet')  // For display
    setWarehouseId('507f1f77bcf86cd799439011')  // For form
  }
})

// 4. Render logic
{isSuperAdmin ? (
  <Select>...</Select>
) : (
  <Badge>Gulshan Outlet</Badge>
)}

// 5. Form submission
const handleSubmit = async (e) => {
  e.preventDefault()
  
  const payload = {
    warehouseId: '507f1f77bcf86cd799439011',  // Auto-selected, NOT user-selected
    mode: 'REMOVE',
    reason: 'Damaged',
    lines: [...]
  }
  
  const response = await createStockAdjustment(token, payload)
  // Server validates: user permission + outlet scope
}
```

---

### Example 2: Stock Count Auto-Selection

```javascript
// Component setup
const user = {
  role: 'CASHIER',
  assignedLocation: '507f1f77bcf86cd799439012',
  name: 'Karim'
}

// Flow:
1. isSuperAdmin = false
2. isRestrictedRole = true
3. assignedOutletId = '507f1f77bcf86cd799439012'

// Load locations
const locations = [
  { id: '507f1f77bcf86cd799439011', name: 'Gulshan Outlet' },
  { id: '507f1f77bcf86cd799439012', name: 'Dhanmondi Outlet' },
  { id: '507f1f77bcf86cd799439013', name: 'Warehouse' }
]

// Auto-select in useEffect
if (isRestrictedRole && assignedOutletId) {
  const assigned = locations.find((loc) => loc.id === '507f1f77bcf86cd799439012')
  // found: { id: '507f1f77bcf86cd799439012', name: 'Dhanmondi Outlet' }
  
  setAssignedOutletName('Dhanmondi Outlet')
  setWarehouseId('507f1f77bcf86cd799439012')
}

// UI Renders
<Badge>Dhanmondi Outlet</Badge>

// Stock count can now be created with this outlet
```

---

### Example 3: POS Billing Outlet Display

```javascript
// Component setup
const user = {
  role: 'CASHIER',
  assignedLocation: '507f1f77bcf86cd799439012',
  name: 'Karim'
}

// Constants
const isSuperAdmin = false
const isRestrictedRole = true
const assignedOutletId = '507f1f77bcf86cd799439012'
const assignedOutletName = user?.name ? `${user.name}'s Outlet` : 'Assigned Outlet'
// assignedOutletName = "Karim's Outlet"

// Header render
return (
  <section>
    <header>
      <h1>Point of Sale</h1>
      <p>Scan items, apply permitted discounts, and complete a bill.</p>
      
      {isRestrictedRole && assignedOutletId && (
        <div className="mt-2">
          <Badge className="inline-block bg-blue-100 text-blue-800">
            Outlet: Karim's Outlet
          </Badge>
        </div>
      )}
    </header>
    ...
  </section>
)

// Visual Output:
┌─────────────────────────────────────────────────────────┐
│ Sales                                                   │
│ Point of Sale                                           │
│ Scan items, apply permitted discounts, and bill         │
│ ╔════════════════════════════════════════════════════╗  │
│ ║ Outlet: Karim's Outlet                             ║  │
│ ╚════════════════════════════════════════════════════╝  │
└─────────────────────────────────────────────────────────┘
```

---

## Comparison: Before vs After

### Before Implementation

```
All users (regardless of role)
    ↓
See full outlet dropdown
    ↓
Can select any location
    ↓
Risk: Wrong outlet selection
Security issue: No UI enforcement
```

### After Implementation

```
Super Admin User
    ↓
See full dropdown → Flexible
    ↓
Can select any outlet → Full control

Restricted User (INVENTORY_MANAGER / CASHIER)
    ↓
See read-only badge → Clear indication
    ↓
Auto-selected outlet → No mistakes
Scoped operations → Security enforced
```

---

## Error Handling

### Case 1: Assigned Outlet Not Found
```javascript
// If user.assignedLocation doesn't exist in locations list
if (isRestrictedRole && assignedOutletId) {
  const assigned = availableLocations.find((loc) => loc.id === assignedOutletId)
  
  if (!assigned) {
    // Outlet not found - show loading state
    setAssignedOutletName('')  // Empty, badge shows "Loading..."
    setWarehouseId('')  // No warehouse selected
    
    // User can't submit form without valid warehouseId
  }
}
```

### Case 2: Locations API Failure
```javascript
// If locations fail to load
Promise.all([getLocations(token)])
  .catch(error => {
    // setError triggers
    // No auto-selection happens
    // warehouseId remains ''
  })
```

---

## Benefits Summary

| Aspect | Benefit |
|--------|---------|
| **Security** | Users can't access wrong outlet data |
| **Usability** | Clear outlet indication in UI |
| **Auditability** | All transactions scoped to location |
| **Flexibility** | Super Admin retains full control |
| **Consistency** | Same pattern across all components |
| **Maintainability** | Simple, reusable logic |

---

## Integration Points

### With Backend
```
Frontend Auto-selects outlet
    ↓
Form submission includes outlet ID
    ↓
Backend receives outlet ID
    ↓
Backend validates: User has permission for outlet
    ↓
Backend processes with outlet scoping
    ↓
StockMovement created with outlet ID
    ↓
Audit log records outlet context
```

### With Redux Auth
```
Login → Backend returns assignedLocation
    ↓
Redux stores in auth.user
    ↓
Component reads from useSelector
    ↓
Auto-selection happens
    ↓
UI updates accordingly
```

---

## Summary

The implementation provides:

1. **Role-Based Access:** Super Admin vs. Restricted Users
2. **Auto-Selection:** Seamless outlet pre-selection
3. **Visual Feedback:** Badge clearly shows current outlet
4. **Security:** Read-only display prevents accidental changes
5. **Consistency:** Same pattern used in all three components
6. **Flexibility:** Super Admin still has full control
7. **Maintainability:** Simple, reusable code structure

Real-world usage flows naturally from user role assignment without additional configuration.
