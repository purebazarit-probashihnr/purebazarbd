const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  GoodsReceive: { create: jest.fn(), find: jest.fn(), findById: jest.fn() },
  Location: { findById: jest.fn() },
  PriceHistory: { create: jest.fn() },
  Product: { create: jest.fn(), exists: jest.fn(), find: jest.fn(), findById: jest.fn() },
  StockMovement: { aggregate: jest.fn(), create: jest.fn() },
  Unit: { find: jest.fn() },
  User: { findById: jest.fn() },
  Vendor: { find: jest.fn(), findById: jest.fn() },
}));

const {
  AuditLog, GoodsReceive, Location, PriceHistory, Product, StockMovement, Unit, User, Vendor,
} = require('../models');
const stockRoutes = require('../routes/stockRoutes');
const errorMiddleware = require('../middlewares/errorMiddleware');

const secret = 'goods-receive-integration-test-secret';
const adminId = '65b000000000000000000001';
const warehouseId = '65b000000000000000000002';
const productId = '65b000000000000000000003';
const vendorId = '65b000000000000000000004';
const unitId = '65b000000000000000000005';
const outletId = '65b000000000000000000006';
const otherOutletId = '65b000000000000000000007';
const admin = {
  _id: adminId,
  isActive: true,
  locationId: warehouseId,
  roleId: { name: 'Inventory Manager', permissions: ['stock:read', 'stock:write'] },
};
const rice = {
  _id: productId, name: 'Rice', barcode: '4006381333931', unitId, ownerType: 'COMPANY',
};

function productQuery(result) {
  const query = {
    select: jest.fn(() => query),
    sort: jest.fn(() => query),
    lean: jest.fn(() => Promise.resolve(result)),
  };
  return query;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', stockRoutes);
  app.use(errorMiddleware);
  return app;
}

function newReceive(data) {
  return {
    ...data,
    _id: new mongoose.Types.ObjectId(),
    status: data.status || 'Draft',
    toObject() {
      return { ...this, toObject: undefined, save: undefined, _id: this._id };
    },
    async save() {},
  };
}

describe('goods receive and movement-derived stock endpoints', () => {
  const app = createApp();
  const auth = { Authorization: `Bearer ${jwt.sign({ sub: adminId }, secret, { expiresIn: '1h' })}` };
  let receives;
  let movements;
  let session;
  let vendorStatus;
  let currentUser;

  function currentStock(locationId) {
    return movements
      .filter((movement) => !locationId || movement.warehouseId.toString() === locationId.toString())
      .reduce((sum, movement) => sum + movement.quantity, 0);
  }

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jest.clearAllMocks();
    receives = new Map();
    movements = [];
    vendorStatus = 'Active';
    currentUser = admin;
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
    User.findById.mockImplementation(() => ({ populate: jest.fn().mockResolvedValue(currentUser) }));
    Location.findById.mockImplementation((id) => ({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          _id: id,
          name: 'Test location',
          type: id.toString() === warehouseId ? 'CENTRAL' : 'OUTLET',
          isActive: true,
        }),
      }),
    }));
    Vendor.find.mockReturnValue(productQuery([{
      _id: new mongoose.Types.ObjectId(vendorId),
      name: 'Example Vendor',
      shopName: 'Example Shop',
      memberId: 'V-001',
      status: 'Active',
    }]));
    Vendor.findById.mockImplementation((id) => ({
      select: jest.fn(() => ({
        lean: jest.fn(async () => ({ _id: id, status: vendorStatus })),
      })),
      lean: jest.fn(async () => ({ _id: id, status: vendorStatus })),
    }));
    Product.find.mockImplementation(() => productQuery([rice]));
    Product.exists.mockResolvedValue(false);
    PriceHistory.create.mockResolvedValue({});
    Unit.find.mockReturnValue(productQuery([{
      _id: unitId, name: 'Box', abbreviation: 'box',
    }]));
    AuditLog.create.mockResolvedValue({});
    GoodsReceive.create.mockImplementation(async ([data]) => {
      const receive = newReceive(data);
      receives.set(receive._id.toString(), receive);
      return [receive];
    });

    GoodsReceive.findById.mockImplementation((id) => {
      const receive = receives.get(id.toString()) || null;
      return {
        session: jest.fn(() => Promise.resolve(receive)),
        lean: jest.fn(() => Promise.resolve(receive)),
        then: (resolve, reject) => Promise.resolve(receive).then(resolve, reject),
      };
    });
    GoodsReceive.find.mockImplementation((filter = {}) => ({
      sort: jest.fn(() => ({
        lean: jest.fn(async () => [...receives.values()].filter((receive) => (
          !filter.warehouseId || receive.warehouseId.toString() === filter.warehouseId.toString()
        ))),
      })),
    }));
    StockMovement.create.mockImplementation(async (docs) => {
      movements.push(...docs);
      return docs;
    });
    StockMovement.aggregate.mockImplementation(async ([match]) => {
      const quantity = currentStock(match.$match.warehouseId);
      return quantity ? [{ _id: new mongoose.Types.ObjectId(productId), quantity }] : [];
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a vendor copy from the GRN inline offer endpoint', async () => {
    const targetVendorId = new mongoose.Types.ObjectId('65b000000000000000000008');
    const source = {
      ...rice,
      vendorPrice: 70,
      mrp: 100,
      vatApplicable: false,
      barcodeSource: 'manufacturer',
      barcodes: ['01234567'],
      save: jest.fn(),
    };
    const copy = { ...source, _id: new mongoose.Types.ObjectId(), vendorId: targetVendorId, ownerType: 'VENDOR' };
    Product.findById.mockResolvedValue(source);
    Product.create.mockResolvedValue(copy);

    const response = await request(app).post('/api/goods-receives/vendor-copy').set(auth).send({
      sourceProductId: productId,
      vendorId: targetVendorId.toString(),
      vendorPrice: 70,
      mrp: 100,
    });

    expect(response.status).toBe(201);
    expect(response.body.product).toMatchObject({
      id: copy._id.toString(),
      vendorId: targetVendorId.toString(),
      barcode: source.barcode,
      barcodes: source.barcodes,
    });
    expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'VENDOR',
      vendorId: targetVendorId.toString(),
      productGroupId: source._id,
      barcode: source.barcode,
      barcodes: source.barcodes,
    }));
    expect(PriceHistory.create).toHaveBeenCalled();
  });

  async function createDraft(lines = [{
    productId, receivedQuantity: 13, acceptedQuantity: 13, rejectedQuantity: 0,
  }]) {
    return request(app).post('/api/goods-receives').set(auth).send({
      ownerType: 'COMPANY', warehouseId, lines,
    });
  }

  it('combines repeated products, approves accepted quantity, and returns stock as movement sum', async () => {
    const draft = await createDraft([
      { productId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0 },
      { productId, receivedQuantity: 3, acceptedQuantity: 3, rejectedQuantity: 0 },
    ]);
    expect(draft.status).toBe(201);
    expect(draft.body.goodsReceive.lines).toHaveLength(1);
    expect(draft.body.goodsReceive.lines[0]).toMatchObject({
      receivedQuantity: 13, acceptedQuantity: 13, rejectedQuantity: 0,
    });
    expect(currentStock()).toBe(0);

    const id = draft.body.goodsReceive.id;
    const approved = await request(app).post(`/api/goods-receives/${id}/approve`).set(auth);
    expect(approved.status).toBe(200);
    expect(approved.body.goodsReceive.status).toBe('Approved');
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ quantity: 13, type: 'GRN', warehouseId, productId });

    const stock = await request(app).get(`/api/stock?warehouseId=${warehouseId}`).set(auth);
    expect(stock.status).toBe(200);
    expect(stock.body.stock).toEqual([expect.objectContaining({ productId, quantity: 13 })]);
  });

  it('keeps a draft out of stock', async () => {
    const response = await createDraft();
    expect(response.status).toBe(201);
    expect(response.body.goodsReceive).toMatchObject({
      ownerType: 'COMPANY', vendorId: null, vendorChallanNumber: null,
    });
    expect(currentStock()).toBe(0);
    expect(StockMovement.create).not.toHaveBeenCalled();
  });

  it('allows Super Admin to select any active location for stock and GRNs', async () => {
    currentUser = {
      ...admin,
      locationId: null,
      roleId: { name: 'Super Admin', permissions: ['stock:read', 'stock:write'] },
    };
    const draft = await request(app).post('/api/goods-receives').set(auth).send({
      ownerType: 'COMPANY', warehouseId: outletId,
      lines: [{ productId, receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 }],
    });

    expect(draft.status).toBe(201);
    expect(draft.body.goodsReceive.warehouseId).toBe(outletId);
    await request(app).get(`/api/stock?warehouseId=${outletId}`).set(auth).expect(200);
    await request(app).get(`/api/goods-receives?selectedOutletId=${outletId}`).set(auth).expect(200);
    expect(GoodsReceive.find).toHaveBeenCalledWith({ warehouseId: outletId });
  });

  it('keeps central warehouse GRNs at the assigned warehouse when an outlet is submitted', async () => {
    const draft = await request(app).post('/api/goods-receives').set(auth).send({
      ownerType: 'COMPANY',
      warehouseId: outletId,
      lines: [{ productId, receivedQuantity: 4, acceptedQuantity: 4, rejectedQuantity: 0 }],
    });
    expect(draft.status).toBe(201);
    expect(draft.body.goodsReceive.warehouseId).toBe(warehouseId);

    const approved = await request(app)
      .post(`/api/goods-receives/${draft.body.goodsReceive.id}/approve`).set(auth);
    expect(approved.status).toBe(200);
    expect(movements).toHaveLength(1);
    expect(movements[0].warehouseId.toString()).toBe(warehouseId);
  });

  it('locks an outlet user to their location and receives directly without transfer permission', async () => {
    currentUser = {
      ...admin,
      locationId: outletId,
    };
    movements = [
      { warehouseId, quantity: 20 },
      { warehouseId: otherOutletId, quantity: 7 },
    ];

    const first = await createDraft([{
      productId, receivedQuantity: 10, acceptedQuantity: 10, rejectedQuantity: 0,
    }]);
    expect(first.status).toBe(201);
    expect(first.body.goodsReceive.warehouseId).toBe(outletId);
    expect(currentUser.roleId.permissions).not.toContain('stock:transfer:write');
    await request(app).post(`/api/goods-receives/${first.body.goodsReceive.id}/approve`).set(auth);

    Product.find.mockImplementation(() => productQuery([{
      ...rice, ownerType: 'VENDOR', vendorId,
    }]));
    const second = await request(app).post('/api/goods-receives').set(auth).send({
      ownerType: 'VENDOR',
      vendorId,
      vendorChallanNumber: 'OUTLET-CH-1',
      warehouseId,
      lines: [{ productId, receivedQuantity: 3, acceptedQuantity: 3, rejectedQuantity: 0 }],
    });
    expect(second.status).toBe(201);
    expect(second.body.goodsReceive.warehouseId).toBe(outletId);
    await request(app).post(`/api/goods-receives/${second.body.goodsReceive.id}/approve`).set(auth);

    expect(currentStock(outletId)).toBe(13);
    expect(currentStock(warehouseId)).toBe(20);
    expect(currentStock(otherOutletId)).toBe(7);
    const outletStock = await request(app).get(`/api/stock?warehouseId=${warehouseId}`).set(auth);
    expect(outletStock.status).toBe(200);
    expect(outletStock.body.warehouseId).toBe(outletId);
    expect(outletStock.body.stock[0].quantity).toBe(13);
    expect(movements.filter((movement) => movement.type === 'GRN')).toHaveLength(2);
    expect(movements.filter((movement) => movement.type === 'GRN').map((movement) => movement.warehouseId))
      .toEqual([outletId, outletId]);
  });

  it('forces outlet draft edits to the locked location and hides other locations', async () => {
    currentUser = { ...admin, locationId: outletId };
    const draft = await createDraft();
    const id = draft.body.goodsReceive.id;

    const update = await request(app).put(`/api/goods-receives/${id}`).set(auth).send({
      warehouseId,
      lines: [{ productId, receivedQuantity: 2, acceptedQuantity: 2, rejectedQuantity: 0 }],
    });
    expect(update.status).toBe(200);
    expect(update.body.goodsReceive.warehouseId).toBe(outletId);
    await request(app).get(`/api/goods-receives/${id}`).set(auth).expect(200);

    const otherReceive = newReceive({
      ownerType: 'COMPANY',
      warehouseId,
      lines: [{ productId, receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 }],
      createdBy: adminId,
    });
    receives.set(otherReceive._id.toString(), otherReceive);
    await request(app).get(`/api/goods-receives/${otherReceive._id}`).set(auth).expect(404);
    await request(app).put(`/api/goods-receives/${otherReceive._id}`).set(auth).send({
      lines: [{ productId, receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 }],
    }).expect(404);
    await request(app).get('/api/goods-receives').set(auth).expect(200);
    await request(app).get('/api/goods-receives?selectedOutletId=').set(auth).expect(200);
    await request(app).get(`/api/goods-receives?selectedOutletId=${warehouseId}`).set(auth).expect(200);
    expect(GoodsReceive.find).toHaveBeenCalledWith({ warehouseId: outletId });
  });

  it('lets an all-location reader select another GRN location without widening writes', async () => {
    const remoteReceive = newReceive({
      ownerType: 'COMPANY',
      warehouseId: outletId,
      lines: [{ productId: new mongoose.Types.ObjectId(productId), receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 }],
      createdBy: adminId,
    });
    receives.set(remoteReceive._id.toString(), remoteReceive);
    currentUser = {
      ...admin,
      roleId: {
        name: 'Deputy',
        permissions: ['stock:read', 'stock:write'],
        canViewAllLocations: true,
      },
    };

    const selected = await request(app).get('/api/goods-receives')
      .query({ selectedOutletId: outletId }).set(auth);
    const empty = await request(app).get('/api/goods-receives?selectedOutletId=').set(auth);
    const created = await request(app).post('/api/goods-receives').set(auth).send({
      ownerType: 'COMPANY',
      warehouseId: outletId,
      lines: [{ productId, receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 }],
    });
    const approved = await request(app).post(`/api/goods-receives/${remoteReceive._id}/approve`).set(auth);

    expect(selected.status).toBe(200);
    expect(selected.body.goodsReceives.map((item) => item.warehouseId)).toEqual([outletId]);
    expect(empty.status).toBe(200);
    expect(empty.body.goodsReceives).toHaveLength(1);
    expect(created.status).toBe(201);
    expect(created.body.goodsReceive.warehouseId).toBe(warehouseId);
    expect(approved.status).toBe(404);
  });

  it('returns printable line details and keeps rejected receives out of stock', async () => {
    const draft = await createDraft([{
      productId, receivedQuantity: 15, acceptedQuantity: 10, rejectedQuantity: 5,
    }]);
    const id = draft.body.goodsReceive.id;
    const printable = await request(app).get(`/api/goods-receives/${id}/print`).set(auth);
    expect(printable.status).toBe(200);
    expect(printable.body.goodsReceive.lines[0]).toMatchObject({
      productName: 'Rice', displayName: 'Rice [box]',
      receivedQuantity: 15, acceptedQuantity: 10, rejectedQuantity: 5,
    });

    const rejected = await request(app).post(`/api/goods-receives/${id}/reject`).set(auth);
    expect(rejected.status).toBe(200);
    expect(rejected.body.goodsReceive.status).toBe('Rejected');
    expect(currentStock()).toBe(0);
    expect(StockMovement.create).not.toHaveBeenCalled();
  });

  it('prevents editing an approved GRN', async () => {
    const draft = await createDraft();
    const id = draft.body.goodsReceive.id;
    await request(app).post(`/api/goods-receives/${id}/approve`).set(auth);
    const update = await request(app).put(`/api/goods-receives/${id}`).set(auth).send({
      lines: [{ productId, receivedQuantity: 20, acceptedQuantity: 20, rejectedQuantity: 0 }],
    });
    expect(update.status).toBe(409);
    expect(currentStock()).toBe(13);
  });

  it('rolls back stock when approval fails', async () => {
    const draft = await createDraft();
    const id = draft.body.goodsReceive.id;
    StockMovement.create.mockImplementationOnce(async (docs) => {
      movements.push(...docs);
      throw new Error('movement insert failed');
    });

    const approval = await request(app).post(`/api/goods-receives/${id}/approve`).set(auth);
    expect(approval.status).toBe(500);
    expect(currentStock()).toBe(0);
    expect(receives.get(id).status).toBe('Draft');
    expect(session.endSession).toHaveBeenCalled();
  });

  it('does not expose any direct stock-setting operation', async () => {
    const response = await request(app).put(`/api/stock?warehouseId=${warehouseId}`).set(auth)
      .send({ productId, quantity: 500 });
    expect(response.status).toBe(404);
    expect(StockMovement.create).not.toHaveBeenCalled();
  });

  it('restricts vendor product search to that vendor', async () => {
    await request(app).get(`/api/stock/products?ownerType=VENDOR&vendorId=${vendorId}`).set(auth);
    expect(Product.find).toHaveBeenCalledWith({ ownerType: 'VENDOR', vendorId });
  });

  it('searches company-owned products for company purchases', async () => {
    const response = await request(app).get('/api/stock/products?ownerType=COMPANY&q=Rice').set(auth);

    expect(response.status).toBe(200);
    expect(response.body.products).toEqual([expect.objectContaining({
      id: productId, name: 'Rice', ownerType: 'COMPANY',
    })]);
    expect(Product.find).toHaveBeenCalledWith({
      ownerType: 'COMPANY',
      $or: [{ name: /Rice/i }, { barcode: /Rice/i }, { barcodes: /Rice/i }],
    });
  });

  it('returns active vendors for the GRN vendor selector', async () => {
    const response = await request(app).get('/api/stock/vendors').set(auth);

    expect(response.status).toBe(200);
    expect(response.body.vendors).toEqual([expect.objectContaining({
      id: vendorId, name: 'Example Vendor', shopName: 'Example Shop', memberId: 'V-001',
    })]);
    expect(Vendor.find).toHaveBeenCalledWith({ status: 'Active' });
  });

  it('suggests the next vendor challan number from that vendor\'s receives', async () => {
    GoodsReceive.countDocuments = jest.fn().mockResolvedValue(2);
    GoodsReceive.exists = jest.fn().mockResolvedValueOnce({ _id: 'x' }).mockResolvedValueOnce(null);
    const response = await request(app).get(`/api/stock/vendors/${vendorId}/next-challan`).set(auth);

    expect(response.status).toBe(200);
    expect(response.body.challanNumber).toBe(`CHN-${vendorId.slice(-6).toUpperCase()}-0004`);
  });

  it('blocks a suspended vendor from receiving a new GRN', async () => {
    vendorStatus = 'Suspended';

    const response = await request(app).post('/api/goods-receives').set(auth).send({
      ownerType: 'VENDOR',
      vendorId,
      vendorChallanNumber: 'CH-1',
      warehouseId,
      lines: [{ productId, receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 }],
    });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/active vendors/i);
    expect(GoodsReceive.create).not.toHaveBeenCalled();
  });

  it('blocks approval when a vendor is suspended after a GRN draft is created', async () => {
    Product.find.mockImplementation(() => productQuery([{
      ...rice, ownerType: 'VENDOR', vendorId,
    }]));
    const created = await request(app).post('/api/goods-receives').set(auth).send({
      ownerType: 'VENDOR',
      vendorId,
      vendorChallanNumber: 'CH-1',
      warehouseId,
      lines: [{ productId, receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 }],
    });
    expect(created.status).toBe(201);
    vendorStatus = 'Suspended';

    const response = await request(app)
      .post(`/api/goods-receives/${created.body.goodsReceive.id}/approve`).set(auth);

    expect(response.status).toBe(409);
    expect(StockMovement.create).not.toHaveBeenCalled();
  });
});
