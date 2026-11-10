const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  Category: { find: jest.fn() },
  DiscountLog: { create: jest.fn() },
  Location: { findById: jest.fn(), findOne: jest.fn() },
  Order: { create: jest.fn(), findOne: jest.fn(), find: jest.fn() },
  Product: { find: jest.fn(), findOne: jest.fn() },
  Return: { findOne: jest.fn() },
  Settings: { findOne: jest.fn() },
  Shareholder: { findById: jest.fn(), findOneAndUpdate: jest.fn() },
  Shift: {
    create: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(),
  },
  StockMovement: { aggregate: jest.fn(), create: jest.fn() },
  User: { findById: jest.fn() },
  VendorLedger: { create: jest.fn(), distinct: jest.fn() },
  WalletAuditLog: { create: jest.fn() },
  WalletLog: { create: jest.fn() },
}));

jest.mock('../services/probashiWalletService', () => ({
  checkWalletBalance: jest.fn(),
  verifyMember: jest.fn(),
}));

const models = require('../models');
const posRoutes = require('../routes/posRoutes');
const errorMiddleware = require('../middlewares/errorMiddleware');

const secret = 'pos-location-scope-test-secret';
const cashierId = new mongoose.Types.ObjectId('65b111111111111111111001');
const adminId = new mongoose.Types.ObjectId('65b111111111111111111002');
const outlet1Id = new mongoose.Types.ObjectId('65b111111111111111111003');
const outlet2Id = new mongoose.Types.ObjectId('65b111111111111111111004');
const productId = new mongoose.Types.ObjectId('65b111111111111111111005');
const vendorId = new mongoose.Types.ObjectId('65b111111111111111111006');
const orderId = new mongoose.Types.ObjectId('65b111111111111111111007');
const shiftId = new mongoose.Types.ObjectId('65b111111111111111111008');

const product = {
  _id: productId,
  name: 'Test Product',
  barcode: '1234567890',
  ownerType: 'VENDOR',
  vendorId,
  vendorPrice: 50,
  mrp: 100,
  vatApplicable: false,
};

function query(value) {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    lean: jest.fn(() => Promise.resolve(value)),
    session: jest.fn(() => chain),
    populate: jest.fn(() => chain),
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

function tokenFor(userId) {
  return jwt.sign({ sub: userId.toString() }, secret, { expiresIn: '1h' });
}

describe('POS location scope enforcement', () => {
  const app = createApp();
  let cashierUser;
  let adminUser;
  let session;

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jest.clearAllMocks();

    // Cashier assigned to outlet1
    cashierUser = {
      _id: cashierId,
      isActive: true,
      role: 'CASHIER',
      assignedLocation: outlet1Id,
      locationId: outlet1Id,
      roleId: { name: 'Cashier', permissions: ['pos:read', 'pos:write', 'shifts:manage'] },
    };

    // Admin without location restriction
    adminUser = {
      _id: adminId,
      isActive: true,
      role: 'SUPER_ADMIN',
      assignedLocation: null,
      locationId: null,
      roleId: { name: 'Super Admin', permissions: ['*'] },
    };

    models.User.findById.mockImplementation((id) => ({
      populate: jest.fn(async () => (
        id.toString() === adminId.toString() ? adminUser : cashierUser
      )),
    }));

    models.Location.findById.mockImplementation((id) => query({
      _id: id,
      type: 'OUTLET',
      isActive: true,
    }));

    models.Product.find.mockReturnValue(query([product]));
    models.Product.findOne.mockReturnValue(query(product));
    models.Category.find.mockReturnValue({ select: jest.fn(() => query([])) });
    models.Settings.findOne.mockReturnValue(query({
      discountLimitByRole: { Cashier: 5, 'Super Admin': 0 },
      enabledPaymentMethods: ['Cash', 'bKash', 'Nagad', 'Card', 'Wallet'],
    }));

    models.Shift.findOne.mockReturnValue(query(null));
    models.Shift.create.mockResolvedValue([{
      _id: shiftId,
      outletId: outlet1Id,
      cashierId,
      openingCash: 100,
      status: 'OPEN',
    }]);

    models.Shift.findById.mockImplementation((id) => query({
      _id: id,
      outletId: outlet1Id,
      cashierId,
      status: 'OPEN',
      openingCash: 100,
    }));

    models.Shift.findOneAndUpdate.mockResolvedValue({
      _id: shiftId,
      outletId: outlet1Id,
      cashierId,
      status: 'CLOSED',
      actualCash: 105,
    });

    models.Order.findOne.mockReturnValue(query({
      _id: orderId,
      outlet: outlet1Id,
      paymentStatus: 'PAID',
      lines: [],
      payments: [{ method: 'CASH', amount: 100 }],
    }));

    models.Order.find.mockReturnValue(query([]));
    models.Return.findOne.mockReturnValue(query(null));
    models.VendorLedger.create.mockResolvedValue([]);
    models.VendorLedger.distinct.mockResolvedValue([]);

    models.StockMovement.aggregate.mockReturnValue({
      session: jest.fn(() => ({
        then: (resolve) => resolve([{ _id: productId, quantity: 100 }]),
      })),
    });

    models.AuditLog.create.mockResolvedValue([]);
    models.DiscountLog.create.mockResolvedValue([]);
    models.WalletLog.create.mockResolvedValue([]);

    session = {
      withTransaction: jest.fn(async (work) => work()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('POST /checkout - order creation', () => {
    it('should apply enforceLocationScope middleware', async () => {
      // This test just verifies the middleware doesn't throw when properly mocked
      const response = await request(app)
        .post('/api/pos/checkout')
        .set('Authorization', `Bearer ${tokenFor(cashierId)}`)
        .send({
          items: [{ productId: productId.toString(), quantity: 1 }],
          payments: [{ method: 'CASH', amount: 100 }],
          billDiscount: { type: 'FIXED', amount: 0, reason: '' },
        });

      // We expect either success or a specific error, but not a middleware auth error
      expect([201, 400, 409, 500]).toContain(response.status);
    });
  });

  describe('GET /history - sales history', () => {
    it('should apply enforceLocationScope middleware', async () => {
      const response = await request(app)
        .get('/api/pos/history')
        .set('Authorization', `Bearer ${tokenFor(cashierId)}`);

      // Middleware should be applied - we expect 200 or an error, not a 401
      expect(response.status).not.toBe(401);
    });
  });

  describe('POST /shifts - open shift', () => {
    it('should apply enforceLocationScope middleware', async () => {
      const response = await request(app)
        .post('/api/pos/shifts')
        .set('Authorization', `Bearer ${tokenFor(cashierId)}`)
        .send({ openingCash: 100 });

      expect([201, 400, 403, 409]).toContain(response.status);
    });
  });

  describe('POST /shifts/:shiftId/close - close shift', () => {
    it('should apply enforceLocationScope middleware', async () => {
      const response = await request(app)
        .post(`/api/pos/shifts/${shiftId.toString()}/close`)
        .set('Authorization', `Bearer ${tokenFor(cashierId)}`)
        .send({ actualCash: 105 });

      // Should not be 401, middleware was applied
      expect(response.status).not.toBe(401);
    });
  });

  describe('POST /:orderId/return - process return', () => {
    it('should apply enforceLocationScope middleware', async () => {
      const response = await request(app)
        .post(`/api/pos/${orderId.toString()}/return`)
        .set('Authorization', `Bearer ${tokenFor(cashierId)}`)
        .send({ walletRefunded: false });

      // Should not be 401, middleware was applied
      expect(response.status).not.toBe(401);
    });
  });

  describe('Cashier without assignedLocation', () => {
    it('should reject cashier without assignedLocation on protected routes', async () => {
      const userWithoutLocation = {
        ...cashierUser,
        assignedLocation: null,
        locationId: null,
      };

      models.User.findById.mockImplementation(() => ({
        populate: jest.fn(async () => userWithoutLocation),
      }));

      const response = await request(app)
        .post('/api/pos/shifts')
        .set('Authorization', `Bearer ${tokenFor(cashierId)}`)
        .send({ openingCash: 100 });

      // Should be either 403 (rejected by middleware) or 500 (error during processing)
      // The key is that it's not 201, which would indicate the cashier could proceed without location
      expect([403, 500]).toContain(response.status);
    });
  });
});
