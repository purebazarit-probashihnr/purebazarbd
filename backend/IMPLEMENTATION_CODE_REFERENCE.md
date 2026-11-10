# GRN Controller Implementation - Code Reference

## File: `backend/controllers/goodsReceiveController.js`

### Function: `createGoodsReceive(req, res, next)`

**Purpose**: Create a new Goods Receive record with role-based location handling and immediate warehouse stock updates.

**Signature**:
```javascript
async function createGoodsReceive(req, res, next)
```

**Key Features**:

1. **Role-Based Location Assignment** (Lines 189-197)
   ```javascript
   let locationId = req.body.warehouseId;
   if (req.user.role === 'SUPER_ADMIN') {
     locationId = req.body.warehouseId || req.body.locationId;
   } else if (req.user.role === 'INVENTORY_MANAGER' || req.user.role === 'Staff') {
     locationId = req.user.assignedLocation;
     if (!locationId) {
       throw statusError('User must have an assigned location', 403);
     }
   }
   ```

   - **SUPER_ADMIN**: Optional location override from request body
   - **INVENTORY_MANAGER/Staff**: Forced to use `req.user.assignedLocation`
   - **Validation**: 403 error if user lacks assigned location

2. **Request Validation** (Lines 199-208)
   - Validates location is provided
   - Validates location is CENTRAL warehouse type
   - Validates products match owner type
   - Validates vendor requirements for VENDOR purchases

3. **Transaction Management** (Lines 210-254)
   ```javascript
   session = await mongoose.startSession();
   await session.withTransaction(async () => {
     // All operations within transaction
   });
   ```

4. **GoodsReceive Creation** (Lines 212-221)
   - Normalizes lines (combines duplicates)
   - Creates GoodsReceive document with:
     - ownerType
     - vendorId (if VENDOR)
     - warehouseId (location-controlled)
     - vendorChallanNumber (if VENDOR)
     - lines (product details)
     - createdBy (audit)

5. **Warehouse Stock Upsert** (Lines 224-244)
   ```javascript
   const stockUpdates = lines.map(line => ({
     updateOne: {
       filter: {
         locationId: new mongoose.Types.ObjectId(locationId),
         productId: line.productId,
       },
       update: {
         $inc: { quantity: line.acceptedQuantity || 0 },
         $set: {
           locationId: new mongoose.Types.ObjectId(locationId),
           productId: line.productId,
           updatedAt: new Date(),
         },
       },
       upsert: true,
     },
   }));
   ```

   - **Bulk Operation**: Single MongoDB operation for all products
   - **Increment**: Uses `$inc` to add accepted quantities
   - **Upsert**: Creates new record if doesn't exist
   - **Zero Handling**: Accepts zero quantities without error

6. **Audit Logging** (Lines 246-250)
   - Records CREATE action in AuditLog
   - Includes full GoodsReceive object
   - Captures user IP address

**Request/Response**:
```javascript
// Request
{
  "ownerType": "COMPANY",
  "warehouseId": "...",           // Overrideable for SUPER_ADMIN
  "vendorId": null,               // Required for VENDOR
  "vendorChallanNumber": null,    // Required for VENDOR
  "lines": [{
    "productId": "...",
    "receivedQuantity": 10,
    "acceptedQuantity": 10,
    "rejectedQuantity": 0
  }]
}

// Response (201)
{
  "success": true,
  "goodsReceive": {
    "id": "...",
    "status": "Draft",
    "warehouseId": "...",         // Set by role logic
    "ownerType": "COMPANY",
    "lines": [...]
  }
}
```

**Error Responses**:
- **400**: Missing/invalid warehouseId, non-CENTRAL location
- **403**: User lacks assignedLocation (INVENTORY_MANAGER/Staff)
- **409**: Vendor is not Active
- **500**: Transaction failure (auto-rollback)

---

### Function: `approveGoodsReceive(req, res, next)`

**Purpose**: Approve a draft GoodsReceive and create stock movements/updates.

**Signature**:
```javascript
async function approveGoodsReceive(req, res, next)
```

**Key Features**:

1. **Transaction Setup** (Lines 320-327)
   - Starts MongoDB session
   - Wraps all operations in transaction
   - Ensures consistency across multiple collections

2. **Draft Validation** (Lines 328-338)
   - Verifies GoodsReceive exists
   - Checks status is 'Draft' only
   - Validates vendor is still Active (for VENDOR purchases)

3. **Status Update** (Lines 340-344)
   ```javascript
   const before = receive.toObject();
   receive.status = 'Approved';
   receive.approvedBy = req.user._id;
   await receive.save({ session });
   ```
   - Records audit trail with before state
   - Sets approvedBy for tracking
   - Persists to database within transaction

4. **Stock Movements** (Lines 346-359)
   ```javascript
   const movements = acceptedLines.map((line) => ({
     productId: line.productId,
     warehouseId: receive.warehouseId,
     quantity: line.acceptedQuantity,
     type: 'GRN',
     userId: req.user._id,
     reason: `Goods receive ${receive._id}`,
     referenceId: receive._id,
     referenceType: 'GoodsReceive',
   }));
   ```

   - **Only accepted quantities**: `acceptedQuantity > 0`
   - **Audit trail**: Records in StockMovement collection
   - **Type**: Marks as 'GRN' movement
   - **Reference**: Links back to GoodsReceive

5. **Warehouse Stock Upsert** (Lines 361-381)
   ```javascript
   const stockUpdates = acceptedLines.map(line => ({
     updateOne: {
       filter: {
         locationId: receive.warehouseId,
         productId: line.productId,
       },
       update: {
         $inc: { quantity: line.acceptedQuantity },
         $set: {...},
       },
       upsert: true,
     },
   }));
   ```

   - **Same pattern as create**: Ensures consistency
   - **Incremental**: Adds accepted quantities to existing
   - **Batch operation**: Efficient for multiple products

6. **Audit Logging** (Lines 383-388)
   - Records APPROVE action
   - Includes before and after states
   - Enables audit trail review

**Request/Response**:
```javascript
// Request
POST /api/goods-receives/:id/approve

// Response (200)
{
  "success": true,
  "goodsReceive": {
    "id": "...",
    "status": "Approved",  // Changed from Draft
    "warehouseId": "...",
    "lines": [...]
  }
}
```

**Error Responses**:
- **404**: GoodsReceive not found
- **409**: GoodsReceive not in Draft status
- **409**: Vendor is not Active (for VENDOR purchases)
- **500**: Transaction failure (auto-rollback)

---

## Integration Points

### User Object (from authMiddleware)
```javascript
req.user = {
  _id: ObjectId,
  id: String,
  name: String,
  email: String,
  role: String,              // 'SUPER_ADMIN', 'INVENTORY_MANAGER', 'Staff', etc.
  roleId: ObjectId,
  locationId: ObjectId,
  assignedLocation: ObjectId, // Used for role-based location control
  permissions: String[]
}
```

### Database Collections

**GoodsReceive**:
```javascript
{
  _id: ObjectId,
  ownerType: 'COMPANY' | 'VENDOR',
  vendorId: ObjectId,           // Required if VENDOR
  warehouseId: ObjectId,         // Set by role logic
  vendorChallanNumber: String,   // Required if VENDOR
  status: 'Draft' | 'Approved' | 'Rejected',
  lines: [{
    productId: ObjectId,
    receivedQuantity: Number,
    acceptedQuantity: Number,
    rejectedQuantity: Number
  }],
  createdBy: ObjectId,
  approvedBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

**warehousestocks** (New):
```javascript
{
  _id: ObjectId,
  locationId: ObjectId,  // GoodsReceive warehouseId
  productId: ObjectId,   // Product from line
  quantity: Number,      // Incremented on each approval
  updatedAt: Date        // Timestamp of last change
}
```

**StockMovement** (Updated on approval):
```javascript
{
  _id: ObjectId,
  productId: ObjectId,
  warehouseId: ObjectId,
  quantity: Number,      // Positive for GRN
  type: 'GRN',          // Movement type
  userId: ObjectId,
  reason: String,
  referenceId: ObjectId, // GoodsReceive _id
  referenceType: 'GoodsReceive',
  createdAt: Date
}
```

**AuditLog** (Updated for CREATE and APPROVE):
```javascript
{
  _id: ObjectId,
  actorId: ObjectId,
  action: 'CREATE' | 'APPROVE',
  entity: 'GoodsReceive',
  entityId: ObjectId,
  before: Object,        // Previous state
  after: Object,         // New state
  ipAddress: String,
  createdAt: Date
}
```

---

## Usage Examples

### Example 1: SUPER_ADMIN Creating GRN
```javascript
// SUPER_ADMIN can specify any warehouse
const response = await fetch('/api/goods-receives', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer admin_token' },
  body: JSON.stringify({
    ownerType: 'COMPANY',
    warehouseId: '65b000000000000000000002',
    lines: [{
      productId: '65b000000000000000000003',
      receivedQuantity: 10,
      acceptedQuantity: 10,
      rejectedQuantity: 0
    }]
  })
});
```

### Example 2: INVENTORY_MANAGER Creating GRN
```javascript
// INVENTORY_MANAGER - warehouseId is IGNORED
// Their assignedLocation (65c000000000000000000001) is used instead
const response = await fetch('/api/goods-receives', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer manager_token' },
  body: JSON.stringify({
    ownerType: 'COMPANY',
    warehouseId: '65b000000000000000000002',  // IGNORED - replaced with assignedLocation
    lines: [{
      productId: '65b000000000000000000003',
      receivedQuantity: 10,
      acceptedQuantity: 10,
      rejectedQuantity: 0
    }]
  })
});

// Result: GoodsReceive created with warehouseId = 65c000000000000000000001
//         warehousestocks updated for location 65c000000000000000000001
```

### Example 3: Warehouse Stock Tracking
```javascript
// After first GRN approval:
// warehousestocks: { locationId, productId, quantity: 10 }

// After second GRN approval (same product, same location):
// warehousestocks: { locationId, productId, quantity: 20 }  // Incremented

// Stock query:
const stock = await Stock.findOne({
  locationId: '65c000000000000000000001',
  productId: '65b000000000000000000003'
});
// Result: { quantity: 20, updatedAt: <timestamp> }
```

---

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Find GoodsReceive | O(1) | Indexed by _id |
| Create GoodsReceive | O(n) | n = number of products |
| Bulk write stocks | O(n) | Single network roundtrip |
| Approve GoodsReceive | O(n) | n = number of lines |
| Transaction overhead | O(1) | Negligible with indexes |

**Where n = number of products in GRN**

---

## Testing

### Unit Tests Location
- `backend/tests/grn-warehouse-stock.test.js` (10 tests)
- `backend/tests/goods-receive.integration.test.js` (13 tests)

### Running Tests
```bash
cd backend
npm test -- tests/grn-warehouse-stock.test.js
npm test -- tests/goods-receive.integration.test.js
npm test -- tests/grn-warehouse-stock.test.js tests/goods-receive.integration.test.js
```

### Coverage
- Role-based location logic: ✅ 4 tests
- Stock updates on create: ✅ 4 tests
- Stock updates on approve: ✅ 1 test
- Error handling: ✅ 1 test
- Integration/backward compatibility: ✅ 13 tests

---

## Deployment Checklist

- [ ] Review code changes
- [ ] Ensure MongoDB supports transactions
- [ ] Create warehousestocks collection
- [ ] Create index: `{ locationId: 1, productId: 1 }`
- [ ] Verify INVENTORY_MANAGER/Staff users have assignedLocation
- [ ] Run test suite
- [ ] Deploy to staging
- [ ] Verify warehouse stocks update in staging
- [ ] Deploy to production
- [ ] Monitor stock updates in production

---

**Version**: 1.0
**Last Updated**: 2026-11-10
**Status**: ✅ Complete and Tested
