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

const models = require('../models');
const walletService = require('../services/probashiWalletService');
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
    failLedger = false;
    db = {
      orders: [],
      movements: [{ productId, warehouseId: outletId, quantity: 10, type: 'GRN' }],
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
          .filter((movement) => movement.warehouseId.toString() === filter.warehouseId.toString())
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
      unitsPerPackage: 12,
    }]));
    db.movements = [{ productId, warehouseId: outletId, quantity: 180, type: 'GRN' }];

    const packageResponse = await checkout({
      items: [{ productId: productId.toString(), quantity: 1, unit: 'PACKAGE' }],
      payments: [{ method: 'CASH', amount: 1557 }],
    });
    expect(packageResponse.status).toBe(201);
    expect(packageResponse.body.order).toMatchObject({
      subtotal: 1557,
      grandTotal: 1557,
      lines: [{ quantity: 1, mrp: 1557, subtotal: 1557, baseQuantity: 12 }],
    });
    expect(db.movements.at(-1)).toMatchObject({ quantity: -12, type: 'SALE' });
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
      unitsPerPackage: 12,
    }]));
    db.movements = [{ productId, warehouseId: outletId, quantity: 180, type: 'GRN' }];
    const pieceResponse = await checkout({
      items: [{ productId: productId.toString(), quantity: 1, unit: 'PIECE' }],
      payments: [{ method: 'CASH', amount: 129.75 }],
    });

    expect(pieceResponse.status).toBe(201);
    expect(pieceResponse.body.order).toMatchObject({
      subtotal: 129.75,
      grandTotal: 129.75,
      lines: [{ quantity: 1, mrp: 129.75, subtotal: 129.75, baseQuantity: 1 }],
    });
    expect(db.movements.at(-1).quantity).toBe(-1);
    expect(db.ledgers.at(-1)).toMatchObject({ quantity: 1, vendorPayable: 100 });
  });

  it('completes a wallet sale without a member as MRP total minus 5%, with no Probashi call', async () => {
    const response = await checkout({
      items: line(2), payments: [{ method: 'WALLET' }],
    });
    expect(response.status).toBe(201);
    expect(response.body.order).toMatchObject({
      subtotal: 200, shareholderDiscountAmount: 10, grandTotal: 190,
      payments: [{ method: 'WALLET', amount: 190 }],
    });
    expect(walletService.checkWalletBalance).not.toHaveBeenCalled();
    expect(walletService.verifyMember).not.toHaveBeenCalled();
    expect(db.movements.at(-1)).toMatchObject({ quantity: -2, type: 'SALE' });
    expect(db.ledgers[0]).toMatchObject({ quantity: 2, vendorPayable: 120, companyNet: 70 });
    expect(db.discounts[0]).toMatchObject({ amount: 10, appliedBy: cashierId });
    expect(db.walletLogs[0]).toMatchObject({
      amount: 190, type: 'DEBIT', discountAmount: 10, cashier: cashierId, outlet: outletId,
    });
    expect(db.walletLogs[0].memberId).toBeUndefined();
  });

  it('still rejects wallet combined with another method', async () => {
    const response = await checkout({
      items: line(), payments: [{ method: 'WALLET', amount: 50 }, { method: 'CASH', amount: 45 }],
    });
    expect(response.status).toBe(400);
    expect(db.orders).toHaveLength(0);
  });
  it('rolls back the order, stock, ledger, and audit writes on transaction failure', async () => {
    failLedger = true;
    const response = await checkout({
      items: line(), payments: [{ method: 'CASH', amount: 100 }],
    });
    expect(response.status).toBe(500);
    expect(db.orders).toHaveLength(0);
    expect(db.movements).toHaveLength(1);
    expect(db.ledgers).toHaveLength(0);
    expect(db.audits).toHaveLength(0);
    expect(session.endSession).toHaveBeenCalled();
  });

  it('records stock, vendor ledger, split payments, and receipt lines from the bill', async () => {
    const response = await checkout({
      items: line(2),
      billDiscount: { type: 'FIXED', value: 10, reason: 'Offer' },
      payments: [{ method: 'CASH', amount: 90 }, { method: 'CARD', amount: 100 }],
    });
    expect(response.status).toBe(201);
    expect(response.body.order).toMatchObject({
      paymentStatus: 'PAID', subtotal: 200, otherDiscountAmount: 10, grandTotal: 190,
    });
    expect(response.body.receipt.lines[0]).toMatchObject({
      quantity: 2, subtotal: 200, billDiscountAmount: 10, total: 190,
    });
    expect(db.movements.at(-1)).toMatchObject({ quantity: -2, type: 'SALE' });
    expect(db.ledgers[0]).toMatchObject({
      quantity: 2, vendorPayable: 120, companyNet: 70, entryType: 'SALE',
    });
    expect(db.discounts[0]).toMatchObject({ amount: 10, reason: 'Offer' });
  });

  it('uses the active primary outlet for unassigned cashiers and records it on sales and movements', async () => {
    user = { ...user, locationId: undefined };
    const response = await checkout({
      items: line(), payments: [{ method: 'CASH', amount: 100 }],
    });

    expect(response.status).toBe(201);
    expect(models.Location.findOne).toHaveBeenCalledWith({
      type: 'OUTLET', isActive: { $ne: false },
    });
    expect(models.Location.findOne.mock.results[0].value.sort).toHaveBeenCalledWith({
      isPrimary: -1, createdAt: 1,
    });
    expect(db.orders[0].outlet.toString()).toBe(outletId.toString());
    expect(db.movements.at(-1)).toMatchObject({
      warehouseId: outletId, quantity: -1, type: 'SALE',
    });
    expect(db.movements.at(-1).referenceId.toString()).toBe(db.orders[0]._id.toString());
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
    const approved = await checkout({ ...body, discountApproved: true });
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
      offlineId: 'device-1-order-17',
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
  });

  describe('piece selling from box stock (stock kept in base units)', () => {
    const toffen = {
      _id: productId, name: 'Toffen Tablet', barcode: '8900000000210',
      ownerType: 'VENDOR', vendorId, vendorPrice: 1260, mrp: 2100, unitsPerPackage: 210, vatApplicable: false,
    };
    const pieces = (quantity) => [{ productId: productId.toString(), quantity, unit: 'PIECE' }];

    beforeEach(() => {
      models.Product.find.mockReturnValue(query([toffen]));
      db.movements = [{ productId, warehouseId: outletId, quantity: 5 * 210, type: 'GRN' }];
    });

    it('bills pieces at the per-piece price and deducts exactly those base units', async () => {
      const response = await checkout({
        items: pieces(3), payments: [{ method: 'CASH', amount: 30 }],
      });
      expect(response.status).toBe(201);
      expect(db.orders[0].lines[0]).toMatchObject({
        quantity: 3, unit: 'PIECE', mrp: 10, subtotal: 30,
      });
      expect(db.movements.at(-1).quantity).toBe(-3);
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
      expect(db.movements.at(-1).quantity).toBe(-210);
    });

    it('selling 1 box then 5 pcs reduces stock by 215 base units', async () => {
      await checkout({ items: [{ productId: productId.toString(), quantity: 1 }], payments: [{ method: 'CASH', amount: 2100 }] });
      await checkout({ items: pieces(5), payments: [{ method: 'CASH', amount: 50 }] });
      const left = db.movements.reduce((sum, movement) => sum + movement.quantity, 0);
      expect(left).toBe(5 * 210 - 215);
      expect(db.ledgers.map((ledger) => [ledger.quantity, ledger.vendorPayable])).toEqual([[210, 1260], [5, 30]]);
    });
  });
});
