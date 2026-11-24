const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  Location: { find: jest.fn(), findById: jest.fn() },
  Product: { find: jest.fn() },
  Settings: { findOne: jest.fn() },
  StockMovement: { aggregate: jest.fn(), create: jest.fn() },
  StockTransfer: { create: jest.fn(), find: jest.fn(), findOne: jest.fn() },
  Unit: { find: jest.fn() },
  User: { find: jest.fn(), findById: jest.fn() },
}));

const {
  AuditLog, Location, Product, Settings, StockMovement, StockTransfer, Unit, User,
} = require('../models');
const stockRoutes = require('../routes/stockRoutes');
const errorMiddleware = require('../middlewares/errorMiddleware');

const secret = 'stock-transfer-integration-test-secret';
const centralId = '65b000000000000000000001';
const outletId = '65b000000000000000000002';
const otherOutletId = '65b000000000000000000003';
const warehouseUserId = '65b000000000000000000004';
const outletUserId = '65b000000000000000000005';
const productId = '65b000000000000000000006';
const transferId = '65b000000000000000000007';
const unitId = '65b000000000000000000008';
const locations = new Map([
  [centralId, { _id: new mongoose.Types.ObjectId(centralId), name: 'Central Warehouse', type: 'CENTRAL' }],
  [outletId, { _id: new mongoose.Types.ObjectId(outletId), name: 'Outlet One', type: 'OUTLET' }],
  [otherOutletId, { _id: new mongoose.Types.ObjectId(otherOutletId), name: 'Outlet Two', type: 'OUTLET' }],
]);
const product = {
  _id: new mongoose.Types.ObjectId(productId),
  name: 'Sample Product',
  barcode: '1234567890123',
  unitId: new mongoose.Types.ObjectId(unitId),
  unitsPerPackage: 12,
  mrp: 120,
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', stockRoutes);
  app.use(errorMiddleware);
  return app;
}

function query(value) {
  const result = {
    select: jest.fn(() => result),
    sort: jest.fn(() => result),
    lean: jest.fn(() => Promise.resolve(value)),
    session: jest.fn(() => result),
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return result;
}

function cloneTransfer(transfer) {
  return {
    ...transfer,
    lines: transfer.lines.map((line) => ({ ...line })),
  };
}

function transferDocument(data) {
  const transfer = {
    ...data,
    _id: data._id || new mongoose.Types.ObjectId(transferId),
    status: data.status || 'Requested',
    lines: data.lines.map((line) => ({
      ...line,
      productId: new mongoose.Types.ObjectId(line.productId),
    })),
    toObject() {
      return cloneTransfer(this);
    },
    async save() {},
  };
  return transfer;
}

describe('stock transfer API', () => {
  const app = createApp();
  let currentUser;
  let transfers;
  let movements;
  let auditLogs;
  let session;

  function auth(userId) {
    return { Authorization: `Bearer ${jwt.sign({ sub: userId }, secret)}` };
  }

  function stockAt(locationId) {
    return movements
      .filter((movement) => movement.warehouseId.toString() === locationId)
      .reduce((sum, movement) => sum + movement.quantity, 0);
  }

  function totalStock() {
    return movements.reduce((sum, movement) => sum + movement.quantity, 0);
  }

  async function createRequestedTransfer(quantity = 10) {
    return request(app).post('/api/stock-transfers').set(auth(warehouseUserId)).send({
      fromWarehouseId: centralId,
      toWarehouseId: outletId,
      lines: [{ productId, requestedQuantity: quantity }],
    });
  }

  async function dispatchTransfer(id, quantity = 10) {
    return request(app).post(`/api/stock-transfers/${id}/dispatch`)
      .set(auth(warehouseUserId)).send({
        lines: [{ productId, dispatchedQuantity: quantity }],
        carrierName: 'Sample Carrier',
        carrierPhone: '01700000000',
        vehicle: 'Van 12',
        notes: 'Handle with care',
      });
  }

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jest.clearAllMocks();
    currentUser = {
      _id: warehouseUserId,
      isActive: true,
      roleId: {
        name: 'Warehouse Staff',
        permissions: ['stock:transfer:read', 'stock:transfer:write'],
      },
      locationId: new mongoose.Types.ObjectId(centralId),
    };
    transfers = new Map();
    movements = [{
      productId: new mongoose.Types.ObjectId(productId),
      warehouseId: new mongoose.Types.ObjectId(centralId),
      quantity: 50,
      type: 'GRN',
    }];
    auditLogs = [];
    session = {
      withTransaction: jest.fn(async (callback) => {
        const savedTransfers = new Map([...transfers].map(([key, value]) => [key, cloneTransfer(value)]));
        const savedMovements = [...movements];
        try {
          await callback();
        } catch (error) {
          transfers = savedTransfers;
          movements = savedMovements;
          throw error;
        }
      }),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    User.findById.mockReturnValue({ populate: jest.fn().mockImplementation(async () => currentUser) });
    User.find.mockImplementation(() => ({
      select: jest.fn(() => ({
        lean: jest.fn(async () => [{
          _id: currentUser._id,
          name: currentUser.name || 'Transfer confirmer',
        }]),
      })),
    }));
    Location.findById.mockImplementation((id) => query(locations.get(id.toString()) || null));
    Location.find.mockReturnValue(query([...locations.values()]));
    Product.find.mockReturnValue(query([product]));
    Settings.findOne.mockReturnValue(query({ showPricesOnChallan: false }));
    Unit.find.mockReturnValue(query([{
      _id: new mongoose.Types.ObjectId(unitId),
      name: 'Box',
      abbreviation: 'Box',
    }]));
    AuditLog.create.mockImplementation(async (rows) => { auditLogs.push(...rows); return rows; });
    StockTransfer.create.mockImplementation(async ([data]) => {
      const transfer = transferDocument(data);
      transfers.set(transfer._id.toString(), transfer);
      return [transfer];
    });
    StockTransfer.find.mockImplementation((filter) => query(
      [...transfers.values()].filter((transfer) => Object.entries(filter).every(([key, value]) => (
        key === '$or'
          ? value.some((condition) => Object.entries(condition).every(([field, id]) => (
            transfer[field]?.toString() === id.toString()
          )))
          : transfer[key]?.toString() === value.toString()
      ))).map(cloneTransfer),
    ));
    StockTransfer.findOne.mockImplementation((filter) => {
      const transfer = transfers.get(filter._id.toString());
      const matches = transfer && Object.entries(filter).every(([key, value]) => (
        key === '$or'
          ? value.some((condition) => Object.entries(condition).every(([field, id]) => (
            transfer[field]?.toString() === id.toString()
          )))
          : transfer[key]?.toString() === value.toString()
      ));
      return query(matches ? transfer : null);
    });
    StockMovement.aggregate.mockImplementation((pipeline) => {
      const match = pipeline[0].$match;
      const sums = new Map();
      movements.filter((movement) => (
        movement.warehouseId.toString() === match.warehouseId.toString()
        && match.productId.$in.some((id) => id.toString() === movement.productId.toString())
      )).forEach((movement) => {
        const id = movement.productId.toString();
        sums.set(id, (sums.get(id) || 0) + movement.quantity);
      });
      return {
        session: jest.fn(async () => [...sums].map(([id, quantity]) => ({
          _id: new mongoose.Types.ObjectId(id), quantity,
        }))),
      };
    });
    StockMovement.create.mockImplementation(async (docs) => {
      movements.push(...docs);
      return docs;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests, dispatches, and confirms an exact transfer without changing total stock', async () => {
    const requested = await createRequestedTransfer();
    const id = requested.body.stockTransfer.id;
    expect(requested.status).toBe(201);
    expect(requested.body.stockTransfer.status).toBe('Requested');
    expect(requested.body.stockTransfer.lines[0]).toMatchObject({
      productName: 'Sample Product',
      barcode: '1234567890123',
    });
    expect(totalStock()).toBe(50);

    const warehouseList = await request(app).get('/api/stock-transfers').set(auth(warehouseUserId));
    expect(warehouseList.body.stockTransfers).toHaveLength(1);
    expect(StockTransfer.find).toHaveBeenCalledWith({
      $or: [{ fromWarehouseId: expect.anything() }, { toWarehouseId: expect.anything() }],
    });

    currentUser = {
      _id: outletUserId,
      isActive: true,
      roleId: {
        name: 'Outlet Cashier',
        permissions: ['stock:transfer:read', 'stock:transfer:receive'],
      },
      locationId: new mongoose.Types.ObjectId(outletId),
    };
    Location.find.mockImplementation(() => query([...locations.values()]));
    const outletLocations = await request(app).get('/api/locations').set(auth(outletUserId));
    expect(outletLocations.status).toBe(200);

    const outletList = await request(app).get('/api/stock-transfers').set(auth(outletUserId));
    expect(outletList.body.stockTransfers).toHaveLength(1);
    expect(StockTransfer.find).toHaveBeenLastCalledWith({
      $or: [{ fromWarehouseId: expect.anything() }, { toWarehouseId: expect.anything() }],
    });

    currentUser = {
      _id: warehouseUserId,
      isActive: true,
      roleId: { name: 'Warehouse Staff', permissions: ['stock:transfer:read', 'stock:transfer:write'] },
      locationId: new mongoose.Types.ObjectId(centralId),
    };
    const dispatched = await dispatchTransfer(id);
    expect(dispatched.status).toBe(200);
    expect(dispatched.body.stockTransfer.status).toBe('Dispatched');
    expect(movements.at(-1)).toMatchObject({ type: 'TRANSFER_OUT', quantity: -10 });
    expect(totalStock() + 10).toBe(50);
    expect(stockAt(centralId)).toBe(40);

    currentUser = {
      _id: outletUserId,
      isActive: true,
      roleId: { name: 'Outlet Cashier', permissions: ['stock:transfer:read', 'stock:transfer:receive'] },
      locationId: new mongoose.Types.ObjectId(outletId),
    };
    const received = await request(app).post(`/api/stock-transfers/${id}/receive`)
      .set(auth(outletUserId)).send({ lines: [{ productId, receivedQuantity: 10 }] });
    expect(received.status).toBe(200);
    expect(received.body.stockTransfer.status).toBe('Received');
    expect(movements.at(-1)).toMatchObject({ type: 'TRANSFER_IN', quantity: 10 });
    expect(stockAt(outletId)).toBe(10);
    expect(totalStock()).toBe(50);
  });

  it('records a receipt shortage and blocks access from an unrelated outlet', async () => {
    const requested = await createRequestedTransfer(8);
    const id = requested.body.stockTransfer.id;
    const dispatched = await dispatchTransfer(id, 8);
    expect(dispatched.status).toBe(200);

    currentUser = {
      _id: outletUserId,
      isActive: true,
      roleId: { name: 'Outlet Cashier', permissions: ['stock:transfer:read', 'stock:transfer:receive'] },
      locationId: new mongoose.Types.ObjectId(outletId),
    };
    const received = await request(app).post(`/api/stock-transfers/${id}/receive`)
      .set(auth(outletUserId)).send({ lines: [{ productId, receivedQuantity: 6 }] });

    expect(received.status).toBe(200);
    expect(received.body.stockTransfer).toMatchObject({
      status: 'Discrepancy',
      lines: [{ dispatchedQuantity: 8, receivedQuantity: 6, discrepancyQuantity: 2 }],
    });
    expect(movements.at(-1)).toMatchObject({ type: 'TRANSFER_IN', quantity: 6 });
    expect(stockAt(centralId) + stockAt(outletId) + 2).toBe(50);

    currentUser.locationId = new mongoose.Types.ObjectId(otherOutletId);
    const visible = await request(app).get(`/api/stock-transfers/${id}`).set(auth(outletUserId));
    const wrongOutletReceipt = await request(app).post(`/api/stock-transfers/${id}/receive`)
      .set(auth(outletUserId)).send({ lines: [{ productId, receivedQuantity: 6 }] });
    expect(visible.status).toBe(404);
    expect(wrongOutletReceipt.status).toBe(404);
  });

  it('prints dispatched quantities as Box and Pcs and audits challan reprints', async () => {
    const requested = await createRequestedTransfer();
    const id = requested.body.stockTransfer.id;
    const dispatched = await dispatchTransfer(id, 2.5);
    expect(dispatched.body.stockTransfer).toMatchObject({
      carrierName: 'Sample Carrier',
      carrierPhone: '01700000000',
      vehicle: 'Van 12',
      notes: 'Handle with care',
    });

    currentUser = {
      _id: warehouseUserId,
      isActive: true,
      roleId: { name: 'Warehouse Staff', permissions: ['stock:transfer:read'] },
      locationId: new mongoose.Types.ObjectId(centralId),
    };
    const printable = await request(app).get(`/api/stock-transfers/${id}/challan`)
      .set(auth(warehouseUserId));
    const firstPrint = await request(app).post(`/api/stock-transfers/${id}/challan/print`)
      .set(auth(warehouseUserId));
    const reprint = await request(app).post(`/api/stock-transfers/${id}/challan/print`)
      .set(auth(warehouseUserId));

    expect(printable.status).toBe(200);
    expect(printable.body.challan).toMatchObject({
      challanNumber: id.slice(-8).toUpperCase(),
      fromLocationName: 'Central Warehouse',
      toLocationName: 'Outlet One',
      carrierName: 'Sample Carrier',
      totalLines: 1,
      totalPieces: 30,
      showPricesOnChallan: false,
      lines: [{
        productName: 'Sample Product',
        barcode: '1234567890123',
        unit: 'Box',
        quantity: 2.5,
        boxQuantity: 2,
        pieceQuantity: 6,
      }],
    });
    expect(printable.body.challan.lines[0]).not.toHaveProperty('price');
    expect(firstPrint.body.isReprint).toBe(false);
    expect(reprint.body.isReprint).toBe(true);
    expect(auditLogs.filter((event) => event.action === 'PRINT')).toHaveLength(2);
    expect(auditLogs.filter((event) => event.action === 'PRINT')[1].metadata).toMatchObject({
      challanNumber: id.slice(-8).toUpperCase(),
      reprint: true,
    });

    currentUser = {
      _id: outletUserId,
      isActive: true,
      roleId: {
        name: 'Deputy',
        permissions: ['stock:transfer:read'],
        canViewAllLocations: true,
      },
      locationId: new mongoose.Types.ObjectId(otherOutletId),
    };
    const allLocationChallan = await request(app).get(`/api/stock-transfers/${id}/challan`)
      .set(auth(outletUserId));
    const allLocationPrint = await request(app).post(`/api/stock-transfers/${id}/challan/print`)
      .set(auth(outletUserId));
    expect(allLocationChallan.status).toBe(200);
    expect(allLocationPrint.status).toBe(200);

    currentUser.roleId.canViewAllLocations = false;
    const unrelatedChallan = await request(app).get(`/api/stock-transfers/${id}/challan`)
      .set(auth(outletUserId));
    const unrelatedPrint = await request(app).post(`/api/stock-transfers/${id}/challan/print`)
      .set(auth(outletUserId));
    expect(unrelatedChallan.status).toBe(404);
    expect(unrelatedPrint.status).toBe(404);
  });

  it('includes challan prices only when the setting is enabled', async () => {
    const requested = await createRequestedTransfer();
    const id = requested.body.stockTransfer.id;
    await dispatchTransfer(id, 2);
    Settings.findOne.mockReturnValue(query({ showPricesOnChallan: true }));

    const response = await request(app).get(`/api/stock-transfers/${id}/challan`)
      .set(auth(warehouseUserId));

    expect(response.status).toBe(200);
    expect(response.body.challan.showPricesOnChallan).toBe(true);
    expect(response.body.challan.lines[0].price).toBe(120);
  });

  it('filters transfer reads by the selected location for all-location roles', async () => {
    const requested = await createRequestedTransfer();
    const id = requested.body.stockTransfer.id;
    currentUser = {
      _id: outletUserId,
      isActive: true,
      roleId: {
        name: 'Deputy',
        permissions: ['stock:transfer:read', 'stock:transfer:write'],
        canViewAllLocations: true,
      },
      locationId: new mongoose.Types.ObjectId(otherOutletId),
    };

    const wrongSourceRequest = await request(app).post('/api/stock-transfers')
      .set(auth(outletUserId)).send({
        fromWarehouseId: centralId,
        toWarehouseId: outletId,
        lines: [{ productId, requestedQuantity: 1 }],
      });
    const selected = await request(app).get('/api/stock-transfers')
      .query({ selectedOutletId: outletId }).set(auth(outletUserId));
    const all = await request(app).get('/api/stock-transfers?selectedOutletId=')
      .set(auth(outletUserId));
    currentUser = {
      _id: warehouseUserId,
      isActive: true,
      roleId: {
        name: 'Warehouse Staff',
        permissions: ['stock:transfer:read', 'stock:transfer:write'],
      },
      locationId: new mongoose.Types.ObjectId(centralId),
    };
    const locked = await request(app).get('/api/stock-transfers')
      .query({ selectedOutletId: centralId }).set(auth(warehouseUserId));

    expect(wrongSourceRequest.status).toBe(403);
    expect(selected.status).toBe(200);
    expect(selected.body.stockTransfers.map((transfer) => transfer.id)).toEqual([id]);
    expect(StockTransfer.find).toHaveBeenLastCalledWith({
      $or: [{ fromWarehouseId: expect.anything() }, { toWarehouseId: expect.anything() }],
    });
    expect(all.status).toBe(200);
    expect(all.body.stockTransfers).toHaveLength(1);
    expect(locked.status).toBe(200);
    expect(locked.body.stockTransfers).toHaveLength(1);
  });

  it('filters Super Admin transfer reads by a selected location', async () => {
    currentUser = {
      _id: new mongoose.Types.ObjectId(warehouseUserId),
      isActive: true,
      roleId: { name: 'Super Admin', permissions: ['*'] },
      locationId: null,
    };

    const response = await request(app).get('/api/stock-transfers')
      .query({ selectedOutletId: outletId }).set(auth(warehouseUserId));

    expect(response.status).toBe(200);
    expect(StockTransfer.find).toHaveBeenCalledWith({
      $or: [
        { fromWarehouseId: expect.anything() },
        { toWarehouseId: expect.anything() },
      ],
    });
    const locationFilter = StockTransfer.find.mock.calls.at(-1)[0].$or;
    expect(locationFilter[0].fromWarehouseId.toString()).toBe(outletId);
    expect(locationFilter[1].toWarehouseId.toString()).toBe(outletId);
  });

  it('lets an all-location reader with receive permission confirm any destination transfer', async () => {
    const requested = await createRequestedTransfer(10);
    const id = requested.body.stockTransfer.id;
    const dispatched = await dispatchTransfer(id);
    expect(dispatched.status).toBe(200);
    currentUser = {
      _id: new mongoose.Types.ObjectId(outletUserId),
      name: 'Deputy Receiver',
      isActive: true,
      roleId: {
        name: 'Deputy',
        permissions: ['stock:transfer:read', 'stock:transfer:receive'],
        canViewAllLocations: true,
      },
      locationId: new mongoose.Types.ObjectId(otherOutletId),
    };

    const received = await request(app).post(`/api/stock-transfers/${id}/receive`)
      .set(auth(outletUserId)).send({ lines: [{ productId, receivedQuantity: 8 }] });
    currentUser = {
      ...currentUser,
      roleId: {
        name: 'Deputy',
        permissions: ['stock:transfer:read'],
        canViewAllLocations: true,
      },
    };
    const deniedWithoutPermission = await request(app).post(`/api/stock-transfers/${id}/receive`)
      .set(auth(outletUserId)).send({ lines: [{ productId, receivedQuantity: 8 }] });

    expect(received.status).toBe(200);
    expect(received.body.stockTransfer).toMatchObject({
      status: 'Discrepancy',
      toWarehouseId: outletId,
      receivedByName: 'Deputy Receiver',
      lines: [{ dispatchedQuantity: 10, receivedQuantity: 8, discrepancyQuantity: 2 }],
    });
    expect(movements.at(-1)).toMatchObject({ type: 'TRANSFER_IN', quantity: 8 });
    expect(movements.at(-1).warehouseId.toString()).toBe(outletId);
    const receiptAudit = auditLogs.find((event) => event.action === 'RECEIVE');
    expect(receiptAudit.metadata.confirmedBy.toString()).toBe(currentUser._id.toString());
    expect(receiptAudit.metadata.destination.toString()).toBe(outletId);
    expect(deniedWithoutPermission.status).toBe(403);

    currentUser = {
      _id: warehouseUserId,
      isActive: true,
      roleId: {
        name: 'Warehouse Staff',
        permissions: ['stock:transfer:read', 'stock:transfer:write'],
      },
      locationId: new mongoose.Types.ObjectId(centralId),
    };
    const otherDestination = await request(app).post('/api/stock-transfers')
      .set(auth(warehouseUserId)).send({
        fromWarehouseId: centralId,
        toWarehouseId: otherOutletId,
        lines: [{ productId, requestedQuantity: 1 }],
      });
    const otherDispatched = await dispatchTransfer(otherDestination.body.stockTransfer.id, 1);
    expect(otherDispatched.status).toBe(200);
    currentUser = {
      _id: outletUserId,
      isActive: true,
      roleId: {
        name: 'Outlet Cashier',
        permissions: ['stock:transfer:read', 'stock:transfer:receive'],
      },
      locationId: new mongoose.Types.ObjectId(outletId),
    };
    const wrongOutletReceipt = await request(app)
      .post(`/api/stock-transfers/${otherDestination.body.stockTransfer.id}/receive`)
      .set(auth(outletUserId)).send({ lines: [{ productId, receivedQuantity: 1 }] });
    expect(wrongOutletReceipt.status).toBe(404);
  });

  it('rejects a request greater than Central Warehouse stock', async () => {
    const response = await createRequestedTransfer(51);
    const fractionalQuantity = await createRequestedTransfer(1.5);

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/exceeds the 50 units available in the Central Warehouse/);
    expect(fractionalQuantity.status).toBe(400);
    expect(StockTransfer.create).not.toHaveBeenCalled();
    expect(transfers.size).toBe(0);
  });

  it('rejects dispatch by an outlet and prevents dispatch beyond available stock', async () => {
    const requested = await createRequestedTransfer(10);
    const id = requested.body.stockTransfer.id;
    movements.push({
      productId: new mongoose.Types.ObjectId(productId),
      warehouseId: new mongoose.Types.ObjectId(centralId),
      quantity: -45,
      type: 'TRANSFER_OUT',
    });
    currentUser = {
      _id: outletUserId,
      isActive: true,
      roleId: { name: 'Outlet Cashier', permissions: ['stock:transfer:read', 'stock:transfer:receive'] },
      locationId: new mongoose.Types.ObjectId(outletId),
    };
    const outletRequest = await request(app).post('/api/stock-transfers')
      .set(auth(outletUserId)).send({
        fromWarehouseId: centralId,
        toWarehouseId: outletId,
        lines: [{ productId, requestedQuantity: 1 }],
      });
    expect(outletRequest.status).toBe(403);

    const wrongSide = await request(app).post(`/api/stock-transfers/${id}/dispatch`)
      .set(auth(outletUserId)).send({
        lines: [{ productId, dispatchedQuantity: 6 }],
        carrierName: 'Sample Carrier',
        carrierPhone: '01700000000',
      });
    expect(wrongSide.status).toBe(403);

    currentUser = {
      _id: warehouseUserId,
      isActive: true,
      roleId: { name: 'Warehouse Staff', permissions: ['stock:transfer:read', 'stock:transfer:write'] },
      locationId: new mongoose.Types.ObjectId(centralId),
    };
    const missingCarrier = await request(app).post(`/api/stock-transfers/${id}/dispatch`)
      .set(auth(warehouseUserId)).send({ lines: [{ productId, dispatchedQuantity: 6 }] });
    const excessive = await request(app).post(`/api/stock-transfers/${id}/dispatch`)
      .set(auth(warehouseUserId)).send({
        lines: [{ productId, dispatchedQuantity: 6 }],
        carrierName: 'Sample Carrier',
        carrierPhone: '01700000000',
      });
    expect(missingCarrier.status).toBe(400);
    expect(excessive.status).toBe(409);
    expect(movements).toHaveLength(2);
    expect(transfers.get(id).status).toBe('Requested');
  });
});
