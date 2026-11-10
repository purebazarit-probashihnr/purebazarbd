# GRN Controller Updates - Role-Based Location & Warehouse Stock Management

## Overview
The Goods Receive (GRN) controller has been updated to:
1. Implement role-based location assignment
2. Automatically update warehouse stocks when GRNs are created
3. Support direct warehouse stock collection upserts

## Changes Made

### 1. Role-Based Location Assignment in `createGoodsReceive`

#### Behavior by User Role:

**SUPER_ADMIN:**
- Can specify `warehouseId` or `locationId` from request body
- Uses request body value if provided
- Falls back to `req.body.warehouseId` if available

**INVENTORY_MANAGER or Staff:**
- Forced to use `req.user.assignedLocation`
- Cannot override with request body parameters
- Returns 403 Forbidden if user has no assigned location
- Ensures location-bound employees only work with their assigned warehouse

#### Implementation:
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

### 2. Direct Warehouse Stock Updates

#### On GRN Creation:
- Accepts all lines (even with `acceptedQuantity: 0`)
- Creates/updates `warehousestocks` collection immediately upon creation
- Uses MongoDB bulk write with upsert operations for efficient batch processing
- No central warehouse transfer required

#### Stock Update Logic:
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

if (stockUpdates.length > 0) {
  const warehouseStocksCollection = mongoose.connection.collection('warehousestocks');
  await warehouseStocksCollection.bulkWrite(stockUpdates, { session });
}
```

#### Features:
- ✅ Creates new records if product doesn't exist at location
- ✅ Increments existing records using `$inc` operator
- ✅ Preserves precision with direct database operations
- ✅ Transactional - rolls back on failure
- ✅ Handles zero quantities (rejected items = no stock change)
- ✅ Supports multiple products in single GRN

### 3. Approval Flow Updates in `approveGoodsReceive`

#### Stock Operations on Approval:
1. **Stock Movements Created** - Records audit trail in `stockmovements` collection
2. **Warehouse Stock Upserted** - Updates `warehousestocks` collection
3. **Both in Single Transaction** - Ensures consistency

#### Implementation:
```javascript
const acceptedLines = receive.lines.filter((line) => line.acceptedQuantity > 0);

// Create stock movements for audit trail
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

// Upsert warehouse stocks
const stockUpdates = acceptedLines.map(line => ({
  updateOne: {
    filter: {
      locationId: receive.warehouseId,
      productId: line.productId,
    },
    update: {
      $inc: { quantity: line.acceptedQuantity },
      $set: {
        locationId: receive.warehouseId,
        productId: line.productId,
        updatedAt: new Date(),
      },
    },
    upsert: true,
  },
}));
```

## API Contract

### POST /api/goods-receives (Create GRN)

**Request Body:**
```json
{
  "ownerType": "COMPANY",
  "warehouseId": "65b000000000000000000002",
  "vendorId": null,
  "vendorChallanNumber": null,
  "lines": [
    {
      "productId": "65b000000000000000000003",
      "receivedQuantity": 10,
      "acceptedQuantity": 10,
      "rejectedQuantity": 0
    }
  ]
}
```

**Behavior by Role:**
- **SUPER_ADMIN**: Can specify any `warehouseId`
- **INVENTORY_MANAGER/Staff**: `warehouseId` is overridden by `req.user.assignedLocation`

**Response (201 Created):**
```json
{
  "success": true,
  "goodsReceive": {
    "id": "65c000000000000000000001",
    "status": "Draft",
    "warehouseId": "65b000000000000000000002",
    "ownerType": "COMPANY",
    "lines": [...]
  }
}
```

### POST /api/goods-receives/:id/approve (Approve GRN)

**Side Effects:**
1. GRN status → "Approved"
2. StockMovement records created (audit trail)
3. warehousestocks collection updated/created with inventory quantities

## Database Collections

### warehousestocks Schema
```javascript
{
  _id: ObjectId,
  locationId: ObjectId,      // Reference to Location
  productId: ObjectId,        // Reference to Product
  quantity: Number,           // Current quantity at this location
  updatedAt: Date             // Last update timestamp
}
```

**Index Recommendation:**
```javascript
db.warehousestocks.createIndex({ locationId: 1, productId: 1 }, { unique: true })
```

## Testing

### Test Coverage
Run tests with:
```bash
npm test -- tests/grn-warehouse-stock.test.js
```

**Test Scenarios Covered:**
- ✅ SUPER_ADMIN can use request body warehouseId
- ✅ INVENTORY_MANAGER forced to use assignedLocation
- ✅ Staff role forced to use assignedLocation
- ✅ Rejection when user lacks assignedLocation
- ✅ New warehouse stock records created on GRN creation
- ✅ Existing stock incremented on subsequent GRNs
- ✅ Multiple products handled correctly
- ✅ Zero acceptedQuantity handled correctly
- ✅ Transaction rollback on database failure

## Migration Notes

### For Existing Data:
1. Ensure all INVENTORY_MANAGER and Staff users have `assignedLocation` set
2. Run migration to populate `warehousestocks` from existing StockMovement records if needed
3. Verify Location records have correct `type: 'CENTRAL'` value

### Backward Compatibility:
- Existing approvals continue to work
- New warehouse stock upserts happen only on new GRNs created with updated code
- StockMovement records continue to be created as before (audit trail intact)

## Error Scenarios

| Condition | Status | Message |
|-----------|--------|---------|
| User without assignedLocation | 403 | User must have an assigned location |
| No warehouseId provided (non-ADMIN) | 400 | A valid location (warehouse) ID is required |
| Location type not CENTRAL | 400 | Goods receives must be recorded at a valid Central Warehouse |
| Missing vendor for VENDOR purchase | 400 | Vendor purchases require a vendor |
| Database transaction failure | 500 | Internal server error (auto-rollback) |

## Performance Considerations

1. **Bulk Write Operation**: Uses MongoDB bulkWrite for batch efficiency
   - Single network round-trip for multiple stock updates
   - Atomic at collection level

2. **Indexed Lookups**: Consider adding indexes on warehousestocks:
   ```javascript
   db.warehousestocks.createIndex({ locationId: 1, productId: 1 })
   db.warehousestocks.createIndex({ locationId: 1 })
   ```

3. **Transaction Support**: Uses MongoDB sessions
   - Ensures consistency between GoodsReceive, StockMovement, and warehousestocks
   - Requires replica set or standalone with journaling

## Troubleshooting

### Issue: "User must have an assigned location"
**Solution**: Ensure the user's `assignedLocation` field is populated in the User document

### Issue: Stock not updating on GRN creation
**Verify**:
1. User role is correctly set
2. Location is type CENTRAL
3. MongoDB connection supports transactions (replica set required)
4. `warehousestocks` collection exists

### Issue: Transaction rollback on error
**Check logs for**:
1. Database connectivity
2. Validation errors on lines
3. Vendor status (must be "Active" for VENDOR purchases)

## Related Files Modified

- `backend/controllers/goodsReceiveController.js`
  - `createGoodsReceive()` - Added role-based location logic and warehouse stock upsert
  - `approveGoodsReceive()` - Added warehouse stock upsert on approval

## Test File

- `backend/tests/grn-warehouse-stock.test.js` - Comprehensive test suite
