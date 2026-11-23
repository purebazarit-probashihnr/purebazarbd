const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  Location: { findById: jest.fn() },
  Order: { find: jest.fn() },
  Shift: {
    create: jest.fn(), findOne: jest.fn(), findById: jest.fn(), findOneAndUpdate: jest.fn(),
  },
  User: { findById: jest.fn() },
}));

const models = require('../models');
const posRoutes = require('../routes/posRoutes');
const errorMiddleware = require('../middlewares/errorMiddleware');

const secret = 'pos-shifts-test-secret';
const cashierId = new mongoose.Types.ObjectId('65b000000000000000000021');
const outletId = new mongoose.Types.ObjectId('65b000000000000000000022');
const otherOutletId = new mongoose.Types.ObjectId('65b000000000000000000025');
const shiftId = new mongoose.Types.ObjectId('65b000000000000000000023');
const otherCashierId = new mongoose.Types.ObjectId('65b000000000000000000024');

function query(value) {
  const chain = {
    select: jest.fn(() => chain),
    session: jest.fn(() => chain),
    lean: jest.fn(async () => value),
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

describe('POS cashier shifts API', () => {
  const app = createApp();
  let user;
  let db;
  let session;

  const auth = () => ({
    Authorization: `Bearer ${jwt.sign({ sub: cashierId.toString() }, secret)}`,
  });

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jest.clearAllMocks();
    user = {
      _id: cashierId,
      isActive: true,
      roleId: { name: 'Cashier', permissions: ['pos:read', 'pos:write', 'shifts:manage'] },
      locationId: outletId,
    };
    db = {
      shift: null,
      orders: [],
      audits: [],
    };
    models.User.findById.mockReturnValue({
      populate: jest.fn().mockImplementation(async () => user),
    });
    models.Location.findById.mockReturnValue(query({
      _id: outletId, type: 'OUTLET', isActive: true,
    }));
    models.Shift.findOne.mockImplementation(() => query(
      db.shift?.status === 'OPEN' ? db.shift : null,
    ));
    models.Shift.create.mockImplementation(async ([data]) => {
      db.shift = { ...data, _id: shiftId, status: 'OPEN' };
      return [db.shift];
    });
    models.Shift.findById.mockImplementation((id) => query(
      id.toString() === shiftId.toString() ? db.shift : null,
    ));
    models.Shift.findOneAndUpdate.mockImplementation(async (filter, update) => {
      if (!db.shift || db.shift.status !== filter.status) return null;
      Object.assign(db.shift, update.$set);
      return db.shift;
    });
    models.Order.find.mockImplementation((filter) => query(db.orders.filter((order) => (
      order.cashier.toString() === filter.cashier.toString()
      && order.outlet.toString() === filter.outlet.toString()
      && order.paymentStatus === filter.paymentStatus
      && filter.$or.some((term) => {
        if (term.offlineId?.$exists) {
          return Boolean(order.offlineId)
            && order.soldAt >= term.soldAt.$gte
            && order.soldAt <= term.soldAt.$lte;
        }
        return !order.offlineId
          && order.createdAt >= term.createdAt.$gte
          && order.createdAt <= term.createdAt.$lte;
      })
    ))));
    models.AuditLog.create.mockImplementation(async (rows) => {
      db.audits.push(...rows);
      return rows;
    });
    session = {
      withTransaction: jest.fn(async (work) => work()),
      endSession: jest.fn(),
    };
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('opens a shift and closes against opening cash plus paid bill cash tenders', async () => {
    const opened = await request(app).post('/api/pos/shifts').set(auth())
      .send({ openingCash: 100, outletId: otherOutletId.toString() });

    expect(opened.status).toBe(201);
    expect(opened.body.shift).toMatchObject({
      cashierId: cashierId.toString(),
      outletId: outletId.toString(),
      openingCash: 100,
      status: 'OPEN',
    });
    expect(db.audits[0]).toMatchObject({ action: 'OPEN', entity: 'Shift' });

    const soldAt = new Date(opened.body.shift.openedAt);
    db.orders = [
      {
        cashier: cashierId, outlet: outletId, paymentStatus: 'PAID', createdAt: soldAt,
        payments: [{ method: 'CASH', amount: 30.25 }, { method: 'CARD', amount: 19.75 }],
      },
      {
        cashier: cashierId, outlet: outletId, paymentStatus: 'PAID', createdAt: soldAt,
        payments: [{ method: 'CASH', amount: 10 }, { method: 'BKASH', amount: 20 }],
      },
      {
        cashier: cashierId, outlet: otherOutletId, paymentStatus: 'PAID', createdAt: soldAt,
        payments: [{ method: 'CASH', amount: 500 }],
      },
      {
        cashier: cashierId, outlet: outletId, paymentStatus: 'REFUNDED', createdAt: soldAt,
        payments: [{ method: 'CASH', amount: 500 }],
      },
      {
        cashier: otherCashierId, outlet: outletId, paymentStatus: 'PAID', createdAt: soldAt,
        payments: [{ method: 'CASH', amount: 500 }],
      },
      {
        cashier: cashierId, outlet: outletId, paymentStatus: 'PAID', offlineId: 'offline-in-shift',
        soldAt: new Date(soldAt.getTime() + 1), createdAt: new Date(Date.now() + 60000),
        payments: [{ method: 'CASH', amount: 7.5 }],
      },
      {
        cashier: cashierId, outlet: outletId, paymentStatus: 'PAID',
        offlineId: 'offline-wallet-in-shift', walletOffline: true, walletVerification: 'pending',
        soldAt: new Date(soldAt.getTime() + 2), createdAt: new Date(Date.now() + 60000),
        payments: [{ method: 'WALLET', amount: 75 }],
      },
      {
        cashier: cashierId, outlet: outletId, paymentStatus: 'PAID', offlineId: 'offline-before-shift',
        soldAt: new Date(soldAt.getTime() - 1), createdAt: soldAt,
        payments: [{ method: 'CASH', amount: 100 }],
      },
    ];

    const closed = await request(app).post(`/api/pos/shifts/${shiftId}/close`).set(auth())
      .send({ actualCash: 145 });

    expect(closed.status).toBe(200);
    expect(closed.body.shift).toMatchObject({
      status: 'CLOSED',
      openingCash: 100,
      expectedCash: 147.75,
      actualCash: 145,
      cashDifference: -2.75,
    });
    expect(closed.body.report).toMatchObject({
      expectedCash: 147.75,
      actualCash: 145,
      cashDifference: -2.75,
      paymentSummary: expect.arrayContaining([
        { method: 'Cash', expectedAmount: 147.75, actualAmount: 145 },
        { method: 'Card', expectedAmount: 19.75, actualAmount: 19.75 },
        { method: 'bKash', expectedAmount: 20, actualAmount: 20 },
      ]),
      offlineWalletPending: { count: 1, amount: 75 },
    });
    expect(models.Order.find).toHaveBeenCalledWith(expect.objectContaining({
      cashier: cashierId,
      outlet: outletId,
      paymentStatus: 'PAID',
    }));
    expect(db.audits.map((event) => event.action)).toEqual(['OPEN', 'CLOSE']);
  });

  it('returns the current shift report and rejects invalid cash values', async () => {
    await request(app).post('/api/pos/shifts').set(auth()).send({ openingCash: 0 });
    const current = await request(app).get('/api/pos/shifts/current').set(auth());
    const invalid = await request(app).post(`/api/pos/shifts/${shiftId}/close`).set(auth())
      .send({ actualCash: -1 });

    expect(current.status).toBe(200);
    expect(current.body.report).toMatchObject({
      expectedCash: 0,
      actualCash: null,
      cashDifference: null,
    });
    expect(invalid.status).toBe(400);
    expect(db.shift.status).toBe('OPEN');
  });

  it('accepts missing and empty location filters on locked-user shift reads', async () => {
    db.shift = {
      _id: shiftId,
      cashierId,
      outletId,
      openingCash: 0,
      openedAt: new Date(),
      status: 'OPEN',
    };

    const currentWithoutLocation = await request(app).get('/api/pos/shifts/current').set(auth());
    const currentWithEmptyLocation = await request(app).get('/api/pos/shifts/current?locationId=').set(auth());
    const reportWithoutLocation = await request(app)
      .get(`/api/pos/shifts/${shiftId}/report`).set(auth());
    const reportWithEmptyLocation = await request(app)
      .get(`/api/pos/shifts/${shiftId}/report?locationId=`).set(auth());

    expect(currentWithoutLocation.status).toBe(200);
    expect(currentWithEmptyLocation.status).toBe(200);
    expect(reportWithoutLocation.status).toBe(200);
    expect(reportWithEmptyLocation.status).toBe(200);
  });

  it('requires shifts:manage for all shift operations', async () => {
    user.roleId.permissions = ['pos:read', 'pos:write'];

    const current = await request(app).get('/api/pos/shifts/current').set(auth());
    const opening = await request(app).post('/api/pos/shifts').set(auth()).send({ openingCash: 0 });

    expect(current.status).toBe(403);
    expect(opening.status).toBe(403);
    expect(models.Shift.create).not.toHaveBeenCalled();
  });

  it('limits shift reports to the owning cashier', async () => {
    db.shift = {
      _id: shiftId,
      cashierId: otherCashierId,
      outletId,
      openingCash: 0,
      openedAt: new Date(),
      status: 'OPEN',
    };

    const response = await request(app).get(`/api/pos/shifts/${shiftId}/report`).set(auth());

    expect(response.status).toBe(403);
  });

  it('lets an all-location reader view shift reports at a selected outlet only', async () => {
    user = {
      ...user,
      roleId: {
        name: 'Deputy',
        permissions: ['pos:read', 'pos:write', 'shifts:manage'],
        canViewAllLocations: true,
      },
      locationId: outletId,
    };
    db.shift = {
      _id: shiftId,
      cashierId: otherCashierId,
      outletId: otherOutletId,
      openingCash: 0,
      openedAt: new Date(),
      status: 'OPEN',
    };

    const selected = await request(app).get(`/api/pos/shifts/${shiftId}/report`)
      .query({ selectedOutletId: otherOutletId.toString() }).set(auth());
    const empty = await request(app).get(`/api/pos/shifts/${shiftId}/report?selectedOutletId=`)
      .set(auth());

    expect(selected.status).toBe(200);
    expect(empty.status).toBe(403);
    expect(empty.body.message).toMatch(/selected outlet/i);
  });

  it('prevents a locked cashier from reading another outlet shift', async () => {
    db.shift = {
      _id: shiftId,
      cashierId,
      outletId: otherOutletId,
      openingCash: 0,
      openedAt: new Date(),
      status: 'OPEN',
    };

    const response = await request(app).get(`/api/pos/shifts/${shiftId}/report`).set(auth());

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/selected outlet/i);
  });

  it('requires a Super Admin to select an outlet for shift operations', async () => {
    user = {
      ...user, roleId: { name: 'Super Admin', permissions: ['*'] },
    };

    const response = await request(app).post('/api/pos/shifts').set(auth()).send({ openingCash: 0 });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/select an outlet/i);
    expect(models.Shift.create).not.toHaveBeenCalled();
  });

  it('keeps all-location shift writes at the assigned outlet despite a read selection', async () => {
    user = {
      ...user,
      roleId: {
        name: 'Deputy',
        permissions: ['pos:read', 'pos:write', 'shifts:manage'],
        canViewAllLocations: true,
      },
    };

    const opened = await request(app).post('/api/pos/shifts')
      .query({ selectedOutletId: otherOutletId.toString() }).set(auth())
      .send({ openingCash: 50, outletId: otherOutletId.toString() });
    const assigned = await request(app).post('/api/pos/shifts').set(auth())
      .send({ openingCash: 50 });

    expect(opened.status).toBe(201);
    expect(opened.body.shift.outletId.toString()).toBe(outletId.toString());
    expect(assigned.status).toBe(409);
    expect(models.Shift.create).toHaveBeenCalledTimes(1);
  });
});
