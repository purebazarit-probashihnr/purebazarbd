const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  Category: { find: jest.fn() },
  DiscountLog: { create: jest.fn() },
  Location: { findById: jest.fn(), findOne: jest.fn() },
  Order: { create: jest.fn(), findOne: jest.fn() },
  Product: { find: jest.fn(), findOne: jest.fn() },
  Settings: { findOne: jest.fn() },
  Shareholder: { findById: jest.fn(), findOneAndUpdate: jest.fn() },
  StockMovement: { aggregate: jest.fn(), create: jest.fn() },
  User: { findById: jest.fn() },
  VendorLedger: { create: jest.fn() },
  WalletAuditLog: { create: jest.fn() },
  WalletLog: { create: jest.fn() },
}));

jest.mock('../services/probashiWalletService', () => ({
  checkWalletBalance: jest.fn(),
  verifyMember: jest.fn(),
}));

jest.mock('../services/offlineWalletVerificationService', () => ({
  verifyOfflineWalletOrder: jest.fn(),
}));

const models = require('../models');
const walletService = require('../services/probashiWalletService');
const offlineWalletVerifier = require('../services/offlineWalletVerificationService');
const posRoutes = require('../routes/posRoutes');
const errorMiddleware = require('../middlewares/errorMiddleware');

const secret = 'pos-integration-test-secret';
const cashierId = new mongoose.Types.ObjectId('65b000000000000000000001');
const adminId = new mongoose.Types.ObjectId('65b000000000000000000002');
const outletId = new mongoose.Types.ObjectId('65b000000000000000000003');
const productId = new mongoose.Types.ObjectId('65b000000000000000000004');
const vendorId = new mongoose.Types.ObjectId('65b000000000000000000005');
const shareholderId = new mongoose.Types.ObjectId('65b000000000000000000006');
const product = {
  _id: productId, name: 'Olive Oil', barcode: '4006381333931',
  ownerType: 'VENDOR', vendorId, vendorPrice: 60, mrp: 100, vatApplicable: false,
};

function query(value) {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    lean: jest.fn(() => Promise.resolve(value)),
  };
  return chain;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pos', posRoutes);
  app.use(errorMiddleware);
  return app;
}

describe('POS checkout API', () => {
  const app = createApp();
  let db;
  let user;
  let session;
  let failLedger;

  const auth = () => ({
    Authorization: `Bearer ${jwt.sign({ sub: user._id.toString() }, secret)}`,
  });
  const line = (quantity = 1) => [{ productId: productId.toString(), quantity }];
  const preview = (body) => request(app).post('/api/pos/bill').set(auth()).send(body);
  const checkout = (body) => request(app).post('/api/pos/checkout').set(auth()).send(body);

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jest.clearAllMocks();
    offlineWalletVerifier.verifyOfflineWalletOrder.mockResolvedValue({});
    failLedger = false;
    db = {
      orders: [],
      movements: [
        { productId, warehouseId: outletId, quantity: 10, type: 'GRN' },
        { productId, warehouseId: new mongoose.Types.ObjectId('65b000000000000000000007'), quantity: 50, type: 'GRN' },
      ],
      ledgers: [],
      walletLogs: [],
      discounts: [],
      audits: [],
    };
    user = {
      _id: cashierId, isActive: true, roleId: { name: 'Cashier', permissions: ['pos:read', 'pos:write'] },
      locationId: outletId,
    };
    models.User.findById.mockReturnValue({ populate: jest.fn().mockImplementation(async () => user) });
    models.Product.find.mockReturnValue(query([product]));
    models.Product.findOne.mockReturnValue(query(product));
    models.Category.find.mockReturnValue({
      select: jest.fn(() => query([])),
    });
    models.Settings.findOne.mockReturnValue(query({
      discountLimitByRole: { Cashier: 5, 'Super Admin': 0 },
      enabledPaymentMethods: ['Cash', 'bKash', 'Nagad', 'Card', 'Wallet'],
      allowWalletPaymentOffline: true,
      maximumOfflineWalletAmountPerBill: 2000,
    }));
    models.Shareholder.findById.mockReturnValue(query({
      _id: shareholderId, memberId: 'PB-001', verified: true, active: true, walletEnabled: true,
    }));
    models.Location.findById.mockReturnValue(query({ _id: outletId, type: 'OUTLET' }));
    models.Location.findOne.mockReturnValue(query({
      _id: outletId, type: 'OUTLET', isActive: true, isPrimary: true,
    }));
    models.Order.findOne.mockImplementation(({ offlineId }) => query(
      db.orders.find((order) => order.offlineId === offlineId) || null,
    ));
    models.Order.create.mockImplementation(async ([data]) => {
      const order = { ...data, _id: new mongoose.Types.ObjectId(), createdAt: new Date() };
      db.orders.push(order);
      return [order];
    });
    models.StockMovement.aggregate.mockImplementation((pipeline) => ({
      session: jest.fn(async () => {
        const filter = pipeline[0].$match;
        const available = db.movements
          .filter((movement) => filter.warehouseId instanceof mongoose.Types.ObjectId
            && movement.warehouseId.toString() === filter.warehouseId.toString())
          .reduce((sum, movement) => sum + movement.quantity, 0);
        return available ? [{ _id: productId, quantity: available }] : [];
      }),
    }));
    models.StockMovement.create.mockImplementation(async (rows) => {
      db.movements.push(...rows);
      return rows;
    });
    models.VendorLedger.create.mockImplementation(async (rows) => {
      if (failLedger) throw new Error('simulated ledger write failure');
      db.ledgers.push(...rows);
      return rows;
    });
    models.WalletLog.create.mockImplementation(async (rows) => {
      db.walletLogs.push(...rows);
      return rows;
    });
    models.DiscountLog.create.mockImplementation(async (rows) => {
      db.discounts.push(...rows);
      return rows;
    });
    models.AuditLog.create.mockImplementation(async (rows) => {
      db.audits.push(...rows);
      return rows;
    });
    models.WalletAuditLog.create.mockResolvedValue({});
    walletService.checkWalletBalance.mockResolvedValue({ sufficient: true });
    session = {
      withTransaction: jest.fn(async (work) => {
        const saved = Object.fromEntries(Object.entries(db).map(([key, value]) => (
          [key, [...value]]
        )));
        try {
          await work();
        } catch (error) {
          Object.assign(db, saved);
          throw error;
        }
      }),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('completes a full wallet payment at the 5% discount without a shareholder', async () => {
    const response = await checkout({
      items: line(), payments: [{ method: 'WALLET' }],
    });
    expect(response.status).toBe(201);
    expect(db.orders).toHaveLength(1);
    expect(db.orders[0].grandTotal).toBeCloseTo(db.orders[0].subtotal * 0.95, 2);
    expect(db.orders[0].payments[0].amount).toBe(db.orders[0].grandTotal);
    expect(walletService.checkWalletBalance).not.toHaveBeenCalled();
  });

  it('persists a successful member verification as verified for automatic discounts', async () => {
    const verified = {
      _id: shareholderId,
      memberId: 'PB-001',
      name: 'Verified Member',
      mobile: '01700000000',
      valid: true,
      active: true,
      walletEnabled: true,
      verified: true,
    };
    walletService.verifyMember.mockResolvedValue({
      memberId: verified.memberId,
      name: verified.name,
      mobile: verified.mobile,
      valid: true,
      active: true,
      walletEnabled: true,
    });
    models.Shareholder.findOneAndUpdate.mockResolvedValue(verified);

    const response = await request(app)
      .post('/api/pos/verify-member')
      .set(auth())
      .send({ memberId: verified.memberId });

    expect(response.status).toBe(200);
    expect(models.Shareholder.findOneAndUpdate).toHaveBeenCalledWith(
      { memberId: verified.memberId },
      { $set: expect.objectContaining({ valid: true, verified: true }) },
      expect.objectContaining({ upsert: true, runValidators: true }),
    );
    expect(response.body.shareholder).toMatchObject({ verified: true, active: true });
  });

  it('automatically calculates verified shareholder discount after manual discounts', async () => {
    const response = await preview({
      items: line(),
      billDiscount: { type: 'PERCENT', value: 10, reason: 'Promotion' },
      payments: [{ method: 'WALLET' }],
      shareholderId: shareholderId.toString(),
    });

    expect(response.status).toBe(200);
    expect(response.body.bill).toMatchObject({
      subtotal: 100,
      otherDiscountAmount: 10,
      shareholderDiscountAmount: 4.5,
      grandTotal: 85.5,
      discountApprovalRequired: true,
    });
  });

  it('rejects shareholder as a reason for a manual discount', async () => {
    const response = await preview({
      items: line(),
      billDiscount: { type: 'PERCENT', value: 5, reason: 'Shareholder' },
      payments: [{ method: 'CASH' }],
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Shareholder discounts are automatic/);
  });

  it('completes a full-stock sale using package and piece prices derived from total MRP', async () => {
    models.Product.find.mockReturnValue(query([{
      ...product,
      vendorPrice: 1200,
      mrp: 1557,
      unitValue: 10,
      unitsPerPackage: 120,
    }]));

    const packageResponse = await checkout({
      items: [{ productId: productId.toString(), quantity: 10, unit: 'PACKAGE' }],
      payments: [{ method: 'CASH', amount: 1557 }],
    });
    expect(packageResponse.status).toBe(201);
    expect(packageResponse.body.order).toMatchObject({
      subtotal: 1557,
      grandTotal: 1557,
      lines: [{ quantity: 10, mrp: 155.7, subtotal: 1557 }],
    });
    expect(db.movements.at(-1)).toMatchObject({ quantity: -10, type: 'SALE' });
    expect(db.ledgers).toHaveLength(1);
    expect(models.StockMovement.create).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ session, ordered: true }),
    );
    expect(models.VendorLedger.create).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ session, ordered: true }),
    );

    models.Product.find.mockReturnValue(query([{
      ...product,
      vendorPrice: 1200,
      mrp: 1557,
      unitValue: 10,
      unitsPerPackage: 120,
    }]));
    db.movements = [{ productId, warehouseId: outletId, quantity: 10, type: 'GRN' }];
    const pieceResponse = await checkout({
      items: [{ productId: productId.toString(), quantity: 1, unit: 'PIECE' }],
      payments: [{ method: 'CASH', amount: 12.98 }],
    });

    expect(pieceResponse.status).toBe(201);
    expect(pieceResponse.body.order).toMatchObject({
      subtotal: 12.98,
      grandTotal: 12.98,
      lines: [{ quantity: 1, mrp: 12.98, subtotal: 12.98 }],
    });
    expect(db.movements.at(-1).quantity).toBeCloseTo(-1 / 120, 10);
  });

  it('checks the final wallet total and returns MRP pricing when balance is insufficient', async () => {
    walletService.checkWalletBalance.mockResolvedValue({ sufficient: false });
    const response = await checkout({
      items: line(),
      payments: [{ method: 'WALLET', amount: 95 }],
      shareholderId: shareholderId.toString(),
    });
    expect(response.status).toBe(409);
    expect(walletService.checkWalletBalance).toHaveBeenCalledWith({ memberId: 'PB-001', amount: 95 });
    expect(response.body.bill).toMatchObject({
      subtotal: 100, shareholderDiscountAmount: 0, grandTotal: 100,
    });
    expect(db.orders).toHaveLength(0);
  });

  it('rolls back the order, stock, ledger, and audit writes on transaction failure', async () => {
    failLedger = true;
    const response = await checkout({
      items: line(), payments: [{ method: 'CASH', amount: 100 }],
    });
    expect(response.status).toBe(500);
    expect(db.orders).toHaveLength(0);
    expect(db.movements).toHaveLength(2);
    expect(db.ledgers).toHaveLength(0);
    expect(db.audits).toHaveLength(0);
    expect(session.endSession).toHaveBeenCalled();
  });

  it('records stock, vendor ledger, split payments, and receipt lines from the bill', async () => {
    const response = await checkout({
      items: line(2),
      billDiscount: { type: 'FIXED', value: 10, reason: 'Offer' },
      payments: [{ method: 'CASH', amount: 90 }, { method: 'CARD', amount: 100 }],
      shareholderId: shareholderId.toString(),
    });

    expect(response.status).toBe(201);
    expect(response.body.order).toMatchObject({
      paymentStatus: 'PAID', subtotal: 200, otherDiscountAmount: 10, grandTotal: 190,
    });

    expect(response.body.order.memberId.toString()).toBe(shareholderId.toString());
    expect(response.body.receipt.lines[0]).toMatchObject({
      quantity: 2, subtotal: 200, billDiscountAmount: 10, total: 190,
    });
    expect(db.movements.at(-1)).toMatchObject({ quantity: -2, type: 'SALE' });
    expect(db.movements.at(-1).warehouseId.toString()).toBe(outletId.toString());
    expect(db.ledgers[0]).toMatchObject({
      quantity: 2, vendorPayable: 120, companyNet: 70, entryType: 'SALE',
      locationId: outletId,
    });
    expect(db.discounts[0]).toMatchObject({ amount: 10, reason: 'Offer' });
  });

  it('posts the vendor ledger against the vendor of the selected product copy', async () => {
    const selectedVendorId = new mongoose.Types.ObjectId('65b000000000000000000009');
    models.Product.find.mockReturnValue(query([{
      ...product,
      vendorId: selectedVendorId,
      vendorPrice: 72,
    }]));

    const response = await checkout({
      items: line(),
      payments: [{ method: 'CASH', amount: 100 }],
    });

    expect(response.status).toBe(201);
    expect(db.ledgers).toHaveLength(1);
    expect(db.ledgers[0]).toMatchObject({
      vendorId: selectedVendorId,
      productId,
      vendorPayable: 72,
      companyNet: 28,
    });
  });

  it('ignores client outlet selections and uses only the assigned outlet for order, stock, and ledger', async () => {
    const otherOutletId = new mongoose.Types.ObjectId('65b000000000000000000007');
    const response = await request(app).post('/api/pos/checkout')
      .query({ selectedOutletId: otherOutletId.toString() })
      .set(auth())
      .send({
        items: line(),
        payments: [{ method: 'CASH', amount: 100 }],
        outletId: otherOutletId.toString(),
      });

    expect(response.status).toBe(201);
    expect(db.orders[0].outlet.toString()).toBe(outletId.toString());
    expect(db.movements.at(-1)).toMatchObject({
      warehouseId: outletId, quantity: -1, type: 'SALE',
    });
    expect(db.ledgers[0].locationId.toString()).toBe(outletId.toString());
    const stockWarehouseId = models.StockMovement.aggregate.mock.calls.at(-1)[0][0].$match.warehouseId;
    expect(stockWarehouseId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(stockWarehouseId.toString()).toBe(outletId.toString());
  });

  it('keeps sales by an all-location reader at the assigned outlet', async () => {
    const otherOutletId = new mongoose.Types.ObjectId('65b000000000000000000007');
    user.roleId.canViewAllLocations = true;
    const response = await request(app).post('/api/pos/checkout')
      .query({ selectedOutletId: otherOutletId.toString() })
      .set(auth())
      .send({
        items: line(),
        payments: [{ method: 'CASH', amount: 100 }],
        outletId: otherOutletId.toString(),
      });

    expect(response.status).toBe(201);
    expect(db.orders[0].outlet.toString()).toBe(outletId.toString());
    expect(db.movements.at(-1).warehouseId.toString()).toBe(outletId.toString());
  });

  it('uses the selected Super Admin outlet and package stock when selling pieces', async () => {
    const otherOutletId = new mongoose.Types.ObjectId('65b000000000000000000007');
    const monas = {
      ...product, name: 'Monas-10', unitValue: 1, unitsPerPackage: 100,
    };
    user = {
      ...user, _id: adminId, locationId: null,
      roleId: { name: 'Super Admin', permissions: ['*'] },
    };
    models.Product.find.mockReturnValue(query([monas]));
    db.movements = [
      { productId, warehouseId: outletId, quantity: 1.7, type: 'GRN' },
      { productId, warehouseId: otherOutletId, quantity: 25, type: 'GRN' },
    ];

    const response = await request(app).post('/api/pos/checkout')
      .query({ selectedOutletId: outletId.toString() })
      .set(auth())
      .send({
        items: [{ productId: productId.toString(), quantity: 10, unit: 'PIECE' }],
        payments: [{ method: 'CASH', amount: 10 }],
      });

    expect(response.status).toBe(201);
    expect(db.orders[0].outlet.toString()).toBe(outletId.toString());
    expect(db.movements.at(-1)).toMatchObject({ quantity: -0.1, type: 'SALE' });
    expect(db.movements.at(-1).warehouseId.toString()).toBe(outletId.toString());
    expect(db.movements
      .filter((movement) => movement.warehouseId.toString() === outletId.toString())
      .reduce((sum, movement) => sum + movement.quantity, 0)).toBeCloseTo(1.6);
    expect(db.movements
      .filter((movement) => movement.warehouseId.toString() === otherOutletId.toString())
      .reduce((sum, movement) => sum + movement.quantity, 0)).toBe(25);
    const stockWarehouseId = models.StockMovement.aggregate.mock.calls.at(-1)[0][0].$match.warehouseId;
    expect(stockWarehouseId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(stockWarehouseId.toString()).toBe(outletId.toString());
  });

  it('sells one package from Super Admin-selected outlet stock', async () => {
    const monas = { ...product, name: 'Monas-10', unitValue: 1, unitsPerPackage: 100 };
    user = {
      ...user, _id: adminId, locationId: null,
      roleId: { name: 'Super Admin', permissions: ['*'] },
    };
    models.Product.find.mockReturnValue(query([monas]));
    db.movements = [{ productId, warehouseId: outletId, quantity: 1.7, type: 'GRN' }];

    const response = await request(app).post('/api/pos/checkout')
      .query({ selectedOutletId: outletId.toString() })
      .set(auth())
      .send({
        items: [{ productId: productId.toString(), quantity: 1, unit: 'PACKAGE' }],
        payments: [{ method: 'CASH', amount: 100 }],
      });

    expect(response.status).toBe(201);
    expect(db.movements.at(-1)).toMatchObject({ quantity: -1, type: 'SALE' });
    expect(db.movements.at(-1).warehouseId.toString()).toBe(outletId.toString());
  });

  it('reports readable available stock when a Super Admin oversells pieces', async () => {
    const monas = { ...product, name: 'Monas-10', unitValue: 1, unitsPerPackage: 100 };
    user = {
      ...user, _id: adminId, locationId: null,
      roleId: { name: 'Super Admin', permissions: ['*'] },
    };
    models.Product.find.mockReturnValue(query([monas]));
    db.movements = [{ productId, warehouseId: outletId, quantity: 1.7, type: 'GRN' }];

    const response = await request(app).post('/api/pos/checkout')
      .query({ selectedOutletId: outletId.toString() })
      .set(auth())
      .send({
        items: [{ productId: productId.toString(), quantity: 171, unit: 'PIECE' }],
        payments: [{ method: 'CASH', amount: 171 }],
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('Insufficient outlet stock for Monas-10. Available: 1 Box and 70 Pcs');
    expect(db.orders).toHaveLength(0);
    expect(db.movements).toHaveLength(1);
  });

  it('requires a Super Admin to select an outlet for POS', async () => {
    user = {
      ...user, _id: adminId, roleId: { name: 'Super Admin', permissions: ['*'] },
    };
    const response = await checkout({
      items: line(), payments: [{ method: 'CASH', amount: 100 }],
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/select an outlet/i);
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('rejects POS use by a user assigned to a warehouse', async () => {
    const warehouseId = new mongoose.Types.ObjectId('65b000000000000000000008');
    user = { ...user, locationId: warehouseId };
    models.Location.findById.mockReturnValue(query({
      _id: warehouseId, type: 'CENTRAL', isActive: true,
    }));

    const response = await checkout({
      items: line(), payments: [{ method: 'CASH', amount: 100 }],
    });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/active outlet/i);
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('rejects POS use by a user assigned to an inactive outlet', async () => {
    models.Location.findById.mockReturnValue(query({
      _id: outletId, type: 'OUTLET', isActive: false,
    }));

    const response = await checkout({
      items: line(), payments: [{ method: 'CASH', amount: 100 }],
    });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/active outlet/i);
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('does not fall back to a primary outlet for an unassigned user', async () => {
    user = { ...user, locationId: undefined };
    const response = await checkout({
      items: line(), payments: [{ method: 'CASH', amount: 100 }],
    });

    expect(response.status).toBe(403);
    expect(models.Location.findOne).not.toHaveBeenCalled();
    expect(models.Order.create).not.toHaveBeenCalled();
  });

  it('requires a Super Admin to approve a discount above the cashier limit', async () => {
    const body = {
      items: line(),
      billDiscount: { type: 'PERCENT', value: 10, reason: 'Manager offer' },
      payments: [{ method: 'CASH', amount: 90 }],
    };
    const denied = await checkout(body);
    expect(denied.status).toBe(403);
    expect(db.orders).toHaveLength(0);

    user = {
      ...user, _id: adminId, roleId: { name: 'Super Admin', permissions: ['pos:read', 'pos:write'] },
    };
    const approved = await request(app).post('/api/pos/checkout')
      .query({ selectedOutletId: outletId.toString() })
      .set(auth())
      .send({ ...body, discountApproved: true, outletId: outletId.toString() });
    expect(approved.status).toBe(201);
    expect(db.discounts[0].approvedBy.toString()).toBe(adminId.toString());
  });

  it('does not count the automatic shareholder discount toward the manual discount limit', async () => {
    const response = await preview({
      items: line(),
      payments: [{ method: 'WALLET' }],
      shareholderId: shareholderId.toString(),
    });

    expect(response.status).toBe(200);
    expect(response.body.bill).toMatchObject({
      shareholderDiscountAmount: 5,
      otherDiscountAmount: 0,
      discountApprovalRequired: false,
    });
  });

  it('syncs non-wallet offline bills idempotently and preserves the sale time', async () => {
    const body = {
      offlineId: '31d03b03-95d2-4852-9c7d-899b8fa12217',
      offlineNumber: 'OFF-65B000000000000000000003-17',
      soldAt: '2026-10-18T09:00:00.000Z',
      items: line(),
      payments: [{ method: 'BKASH', amount: 100 }],
    };
    const walletQueue = await request(app).post('/api/pos/offline-sync').set(auth()).send({
      ...body,
      payments: [{ method: 'WALLET', amount: 95 }],
      shareholderId: shareholderId.toString(),
    });
    expect(walletQueue.status).toBe(400);
    expect(db.orders).toHaveLength(0);

    const first = await request(app).post('/api/pos/offline-sync').set(auth()).send(body);
    const duplicate = await request(app).post('/api/pos/offline-sync').set(auth()).send(body);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ synced: true, duplicate: false });
    expect(new Date(first.body.receipt.soldAt).toISOString()).toBe(body.soldAt);
    expect(duplicate.body).toMatchObject({ synced: true, duplicate: true });
    expect(db.orders).toHaveLength(1);
    expect(db.ledgers).toHaveLength(1);
    expect(db.movements.filter((movement) => movement.type === 'SALE')).toHaveLength(1);
  });

  it('syncs offline wallet bills without identifiers, once, as unverifiable', async () => {
    const body = {
      offlineId: '4bf76c78-bd69-4c74-800f-1c85797e2355',
      offlineNumber: 'OFF-65B000000000000000000003-19',
      soldAt: '2026-10-18T09:00:00.000Z',
      items: line(),
      payments: [{ method: 'WALLET', amount: 0.01 }],
      walletOffline: true,
    };

    const first = await request(app).post('/api/pos/offline-sync').set(auth()).send(body);
    const duplicate = await request(app).post('/api/pos/offline-sync').set(auth()).send(body);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      synced: true, duplicate: false, walletUnverifiable: true,
      note: 'No member ID or reference recorded',
      order: {
        walletOffline: true,
        walletVerification: 'unverifiable',
        walletVerificationReason: 'No member ID or reference recorded',
        shareholderDiscountAmount: 5, grandTotal: 95,
        payments: [{ method: 'WALLET', amount: 95 }],
      },
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({
      synced: true,
      duplicate: true,
      walletUnverifiable: true,
      order: {
        walletVerification: 'unverifiable',
        walletVerificationReason: 'No member ID or reference recorded',
      },
    });
    expect(db.orders).toHaveLength(1);
    expect(walletService.checkWalletBalance).not.toHaveBeenCalled();
    expect(walletService.verifyMember).not.toHaveBeenCalled();
    expect(offlineWalletVerifier.verifyOfflineWalletOrder).not.toHaveBeenCalled();
  });

  it('refuses an offline wallet bill above the configured maximum', async () => {
    models.Settings.findOne.mockReturnValue(query({
      discountLimitByRole: { Cashier: 5 },
      enabledPaymentMethods: ['Cash', 'bKash', 'Nagad', 'Card', 'Wallet'],
      allowWalletPaymentOffline: true,
      maximumOfflineWalletAmountPerBill: 90,
    }));

    const response = await request(app).post('/api/pos/offline-sync').set(auth()).send({
      offlineId: '70db388d-46a9-4c67-b3bd-9ae83733072e',
      offlineNumber: 'OFF-65B000000000000000000003-21',
      items: line(),
      payments: [{ method: 'WALLET', amount: 100 }],
      walletOffline: true,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/limited to 90\.00 per bill/);
    expect(db.orders).toHaveLength(0);
    expect(offlineWalletVerifier.verifyOfflineWalletOrder).not.toHaveBeenCalled();
  });

  it('saves and flags an offline sale that makes outlet stock negative', async () => {
    db.movements = [];
    const response = await request(app).post('/api/pos/offline-sync').set(auth()).send({
      offlineId: 'de973ce2-fc6e-4e16-a282-487fc0a1a0cf',
      offlineNumber: 'OFF-65B000000000000000000003-18',
      soldAt: '2026-10-18T09:10:00.000Z',
      items: line(),
      payments: [{ method: 'CASH', amount: 100 }],
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ synced: true, flagged: true });
    expect(response.body.reviewFlags).toContain(`NEGATIVE_STOCK:${productId}`);
    expect(db.orders[0]).toMatchObject({ reviewRequired: true });
    expect(db.movements).toEqual([expect.objectContaining({ type: 'SALE', quantity: -1 })]);
    expect(db.ledgers).toEqual([expect.objectContaining({
      vendorId, entryType: 'SALE', quantity: 1, vendorPayable: 60, locationId: outletId,
    })]);
  });

  describe('piece selling from box stock', () => {
    const toffen = {
      _id: productId, name: 'Toffen Tablet', barcode: '8900000000210',
      ownerType: 'COMPANY', vendorPrice: 1260, mrp: 2100, unitsPerPackage: 210, vatApplicable: false,
    };
    const pieces = (quantity) => [{ productId: productId.toString(), quantity, unit: 'PIECE' }];

    beforeEach(() => {
      models.Product.find.mockReturnValue(query([toffen]));
      db.movements = [{ productId, warehouseId: outletId, quantity: 5, type: 'GRN' }];
    });

    it('bills pieces at the per-piece price and deducts a fraction of a box', async () => {
      const response = await checkout({
        items: pieces(3), payments: [{ method: 'CASH', amount: 30 }],
      });
      expect(response.status).toBe(201);
      expect(db.orders[0].lines[0]).toMatchObject({
        quantity: 3, unit: 'PIECE', mrp: 10, subtotal: 30,
      });
      expect(db.movements.at(-1).quantity).toBeCloseTo(-3 / 210, 10);
    });

    it('rejects fractional pieces and sales beyond the box stock', async () => {
      const fractional = await checkout({ items: pieces(1.5), payments: [{ method: 'CASH', amount: 15 }] });
      expect(fractional.status).toBe(400);
      const tooMany = await checkout({ items: pieces(5 * 210 + 1), payments: [{ method: 'CASH', amount: 10510 }] });
      expect(tooMany.status).toBe(409);
      expect(db.orders).toHaveLength(0);
    });

    it('still sells whole boxes at the box price', async () => {
      const response = await checkout({
        items: [{ productId: productId.toString(), quantity: 1 }], payments: [{ method: 'CASH', amount: 2100 }],
      });
      expect(response.status).toBe(201);
      expect(db.orders[0].lines[0]).toMatchObject({ unit: 'PACKAGE', mrp: 2100 });
      expect(db.movements.at(-1).quantity).toBe(-1);
    });
  });
});
