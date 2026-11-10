# GRN Controller - Code Changes

## Modified Files

### 1. backend/controllers/goodsReceiveController.js

#### Change 1: createGoodsReceive() Function (Lines 183-255)

**What Changed:**
- Added role-based location assignment logic
- Added warehouse stock upsert on GRN creation
- Changed from simple create to transactional create

**Implementation:**

```javascript
async function createGoodsReceive(req, res, next) {
  let session;
  try {
    const lines = normalizeLines(req.body.lines);
    
    // ===== NEW: Role-based location assignment =====
    let locationId = req.body.warehouseId;
    if (req.user.role === 'SUPER_ADMIN') {
      // SUPER_ADMIN: Can optionally specify locationId from request
      locationId = req.body.warehouseId || req.body.locationId;
    } else if (req.user.role === 'INVENTORY_MANAGER' || req.user.role === 'Staff') {
      // INVENTORY_MANAGER/Staff: Forced to use assignedLocation
      locationId = req.user.assignedLocation;
      if (!locationId) {
        throw statusError('User must have an assigned location', 403);
      }
    }
    
    if (!locationId) {
      throw statusError('A valid location (warehouse) ID is required', 400);
    }
    // ===== END: Role-based location assignment =====
    
    // Use role-controlled locationId for validation
    await validateCentralWarehouse(locationId);
    await validateProducts(req.body.ownerType, req.body.vendorId, lines);
    if (req.body.ownerType === 'VENDOR' && !req.body.vendorChallanNumber) {
      throw statusError('Vendor purchases require a challan number', 400);
    }
    
    // ===== NEW: Transaction wrapper =====
    session = await mongoose.startSession();
    let output;
    await session.withTransaction(async () => {
      const [receive] = await GoodsReceive.create([{
        ownerType: req.body.ownerType,
        ...(req.body.vendorId ? { vendorId: req.body.vendorId } : {}),
        warehouseId: locationId,  // ← Use role-controlled locationId
        ...(req.body.vendorChallanNumber ? { vendorChallanNumber: req.body.vendorChallanNumber } : {}),
        lines,
        createdBy: req.user._id,
      }], { session });
      
      // ===== NEW: Warehouse stock upsert =====
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
      // ===== END: Warehouse stock upsert =====
      
      await AuditLog.create([{
        actorId: req.user._id, action: 'CREATE', entity: 'GoodsReceive', entityId: receive._id,
        after: receive.toObject(), ipAddress: req.ip,
      }], { session });
      
      output = receiveOutput(receive);
    });
    // ===== END: Transaction wrapper =====
    
    return res.status(201).json({ success: true, goodsReceive: output });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
}
```

---

#### Change 2: approveGoodsReceive() Function (Lines 318-386)

**What Changed:**
- Added warehouse stock upsert alongside StockMovement creation
- Both operations now within atomic transaction

**Key Addition (Lines 361-381):**

```javascript
async function approveGoodsReceive(req, res, next) {
  let session;
  try {
    session = await mongoose.startSession();
    let output;
    await session.withTransaction(async () => {
      const receive = await GoodsReceive.findById(req.params.id).session(session);
      if (!receive) throw statusError('Goods receive not found', 404);
      if (receive.status !== 'Draft') throw statusError('Only draft goods receives can be approved', 409);
      if (receive.ownerType === 'VENDOR') {
        const vendor = await Vendor.findById(receive.vendorId).lean();
        if (!vendor) throw statusError('Vendor not found', 404);
        if (vendor.status !== 'Active') {
          throw statusError('Only active vendors can receive new goods', 409);
        }
      }

      const before = receive.toObject();
      receive.status = 'Approved';
      receive.approvedBy = req.user._id;
      await receive.save({ session });
      
      // Filter for lines with accepted quantities
      const acceptedLines = receive.lines.filter((line) => line.acceptedQuantity > 0);
      
      // ===== EXISTING: Create stock movements for audit trail =====
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
      if (movements.length) await StockMovement.create(movements, { session, ordered: true });
      
      // ===== NEW: Upsert warehouse stocks =====
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
      
      if (stockUpdates.length > 0) {
        const warehouseStocksCollection = mongoose.connection.collection('warehousestocks');
        await warehouseStocksCollection.bulkWrite(stockUpdates, { session });
      }
      // ===== END: Upsert warehouse stocks =====
      
      await AuditLog.create([{
        actorId: req.user._id, action: 'APPROVE', entity: 'GoodsReceive', entityId: receive._id,
        before, after: receive.toObject(), ipAddress: req.ip,
      }], { session });
      output = receiveOutput(receive);
    });
    return res.json({ success: true, goodsReceive: output });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
}
```

---

### 2. backend/tests/goods-receive.integration.test.js

#### Change: Add Collection Mock (Line 104)

**What Changed:**
- Added mock for `mongoose.connection.collection()` to support warehousestocks collection access
- Ensures backward compatibility with existing tests

**Implementation:**

```javascript
beforeEach(() => {
  process.env.JWT_SECRET = secret;
  jest.clearAllMocks();
  receives = new Map();
  movements = [];
  vendorStatus = 'Active';
  session = {
    withTransaction: jest.fn(async (callback) => {
      const savedReceives = new Map([...receives].map(([key, value]) => [key, { ...value }]));
      const savedMovements = [...movements];
      try {
        await callback();
      } catch (error) {
        receives = savedReceives;
        movements = savedMovements;
        throw error;
      }
    }),
    endSession: jest.fn(),
  };
  jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
  
  // ===== NEW: Mock collection for warehousestocks =====
  jest.spyOn(mongoose.connection, 'collection').mockReturnValue({
    bulkWrite: jest.fn().mockResolvedValue({ result: { ok: 1 } }),
  });
  // ===== END: Mock collection =====
  
  User.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(admin) });
  // ... rest of setup
});
```

---

## New Files

### 1. backend/tests/grn-warehouse-stock.test.js

**Purpose**: Comprehensive test suite for role-based location and warehouse stock updates

**Coverage**:
- Role-based location assignment (4 tests)
- Warehouse stock creation and updates (4 tests)
- Warehouse stock on approval (1 test)
- Transaction rollback (1 test)

**Total**: 10 tests, 450+ lines

---

## Summary of Changes

| File | Type | Lines | Changes |
|------|------|-------|---------|
| goodsReceiveController.js | Modified | 183-255 | createGoodsReceive() enhanced |
| goodsReceiveController.js | Modified | 318-386 | approveGoodsReceive() enhanced |
| goods-receive.integration.test.js | Modified | 104 | Added collection mock |
| grn-warehouse-stock.test.js | New | 450+ | New test suite |

---

## Key Code Patterns

### Pattern 1: Role-Based Access Control

```javascript
// Determine resource based on user role
let locationId = req.body.warehouseId;
if (req.user.role === 'SUPER_ADMIN') {
  // Allow override from request
  locationId = req.body.warehouseId || req.body.locationId;
} else if (req.user.role === 'INVENTORY_MANAGER' || req.user.role === 'Staff') {
  // Force to assigned location
  locationId = req.user.assignedLocation;
  if (!locationId) {
    throw statusError('User must have an assigned location', 403);
  }
}
```

### Pattern 2: MongoDB Bulk Write with Upsert

```javascript
const updates = items.map(item => ({
  updateOne: {
    filter: { key: value, otherKey: otherValue },
    update: {
      $inc: { quantity: amount },      // Increment
      $set: { updatedAt: new Date() }  // Set metadata
    },
    upsert: true  // Create if doesn't exist
  }
}));

if (updates.length > 0) {
  const collection = mongoose.connection.collection('collectionName');
  await collection.bulkWrite(updates, { session });
}
```

### Pattern 3: Transactional Operations

```javascript
session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    // All operations here are atomic
    await Model1.create([...], { session });
    await Model2.create([...], { session });
    await collection.bulkWrite([...], { session });
  });
} finally {
  if (session) await session.endSession();
}
```

---

## Testing the Changes

### Run New Tests
```bash
npm test -- tests/grn-warehouse-stock.test.js
```

### Run Existing Tests (Verify Compatibility)
```bash
npm test -- tests/goods-receive.integration.test.js
```

### Run All GRN Tests
```bash
npm test -- tests/goods-receive.integration.test.js tests/grn-warehouse-stock.test.js
```

### Expected Output
```
Test Suites: 2 passed
Tests:       23 passed (10 new + 13 existing)
Snapshots:   0 total
Time:        ~2 seconds
```

---

## Deployment Considerations

1. **Database Requirements**
   - MongoDB must support transactions (replica set or journaled standalone)
   - Create `warehousestocks` collection
   - Create index: `{ locationId: 1, productId: 1 }`

2. **Configuration**
   - No new environment variables required
   - No configuration changes needed

3. **Data Migration**
   - No data migration required
   - New warehouse stock updates only on new GRNs
   - Historical data remains unchanged

4. **Compatibility**
   - Fully backward compatible
   - All existing tests pass
   - No breaking changes

---

## Rollback Plan (If Needed)

If issues occur after deployment:

1. **Revert Code**: Deploy previous version of goodsReceiveController.js
2. **Stop New Writes**: GRNs will no longer update warehousestocks
3. **Verify**: Run existing test suite to confirm rollback
4. **Data**: warehousestocks collection remains, can be used for reconciliation

---

**Last Updated**: 2026-11-10
**Status**: ✅ Complete and Tested
