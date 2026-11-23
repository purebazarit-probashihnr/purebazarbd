const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  Location: { find: jest.fn(), findById: jest.fn() },
  Order: {
    find: jest.fn(), findById: jest.fn(), findOne: jest.fn(), findOneAndUpdate: jest.fn(),
  },
  Return: { create: jest.fn(), findOne: jest.fn() },
  StockMovement: { create: jest.fn() },
  User: { findById: jest.fn() },
  VendorLedger: { create: jest.fn(), distinct: jest.fn(), find: jest.fn() },
  WalletLog: { create: jest.fn() },
}));

const models = require('../models');
const posRoutes = require('../routes/posRoutes');
const errorMiddleware = require('../middlewares/errorMiddleware');

const secret = 'pos-history-test-secret';
const cashierId = new mongoose.Types.ObjectId('65b000000000000000000011');
const outletId = new mongoose.Types.ObjectId('65b000000000000000000012');
const otherOutletId = new mongoose.Types.ObjectId('65b000000000000000000017');
const orderId = new mongoose.Types.ObjectId('65b000000000000000000013');
const productId = new mongoose.Types.ObjectId('65b000000000000000000014');
const vendorId = new mongoose.Types.ObjectId('65b000000000000000000015');
const shareholderId = new mongoose.Types.ObjectId('65b000000000000000000016');

function query(value) {
  const chain = {
    select: jest.fn(() => chain),
    session: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    limit: jest.fn(() => chain),
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

describe('POS history and returns API', () => {
  const app = createApp();
  let db;
  let session;
  let user;
  const auth = () => ({
    Authorization: `Bearer ${jwt.sign({ sub: cashierId.toString() }, secret)}`,
  });

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jest.clearAllMocks();
    user = {
      _id: cashierId,
      isActive: true,
      roleId: { name: 'Cashier', permissions: ['pos:read', 'pos:write'] },
      locationId: outletId,
    };
    db = {
      order: {
        _id: orderId,
        orderNumber: 'POS-1',
        paymentStatus: 'PAID',
        outlet: outletId,
        cashier: cashierId,
        memberId: shareholderId,
        grandTotal: 200,
        payments: [{ method: 'CASH', amount: 200 }],
        lines: [{ productId, quantity: 2, total: 200, packageUnitName: 'Box' }],
      },
      returns: [],
      movements: [],
      ledgers: [{
        vendorId, orderId, productId, quantity: 2, entryType: 'SALE',
        vendorPayable: 120, companyNet: 80,
      }],
      audits: [],
      walletLogs: [],
    };
    models.User.findById.mockReturnValue({
      populate: jest.fn().mockImplementation(async () => user),
    });
    models.Location.findById.mockReturnValue(query({ _id: outletId, type: 'OUTLET', isActive: true }));
    models.Location.find.mockReturnValue({
      select: jest.fn(() => query([
        { _id: outletId },
        { _id: otherOutletId },
      ])),
    });
    models.Order.findById.mockImplementation((id) => query(
      id.toString() === orderId.toString() ? db.order : null,
    ));
    models.Order.findOne.mockImplementation(({ _id, outlet }) => query(
      _id.toString() === orderId.toString()
      && outlet.toString() === db.order.outlet.toString()
        ? db.order
        : null,
    ));
    models.Order.find.mockImplementation(() => query([]));
    models.Order.findOneAndUpdate.mockImplementation(async (filter, update) => {
      if (db.order.paymentStatus !== filter.paymentStatus) return null;
      Object.assign(db.order, update.$set);
      return db.order;
    });
    models.Return.findOne.mockImplementation(() => query(
      db.returns.find((record) => record.orderId.toString() === orderId.toString()) || null,
    ));
    models.Return.create.mockImplementation(async ([data]) => {
      const record = { ...data, _id: new mongoose.Types.ObjectId() };
      db.returns.push(record);
      return [record];
    });
    models.StockMovement.create.mockImplementation(async (rows) => {
      db.movements.push(...rows);
      return rows;
    });
    models.VendorLedger.find.mockImplementation(() => query(
      db.ledgers.filter((ledger) => ledger.entryType === 'SALE'),
    ));
    models.VendorLedger.distinct.mockResolvedValue([orderId]);
    models.VendorLedger.create.mockImplementation(async (rows) => {
      db.ledgers.push(...rows);
      return rows;
    });
    models.AuditLog.create.mockImplementation(async (rows) => {
      db.audits.push(...rows);
      return rows;
    });
    models.WalletLog.create.mockImplementation(async (rows) => {
      db.walletLogs.push(...rows);
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

  it('filters sales history by outlet, cashier, date, payment, vendor, and shareholder', async () => {
    user = { ...user, roleId: { name: 'Super Admin', permissions: ['*'] } };
    const response = await request(app).get('/api/pos/history')
      .query({
        selectedOutletId: outletId.toString(),
        outlet: outletId.toString(),
        cashier: cashierId.toString(),
        date: '2026-10-18',
        paymentMethod: 'CARD',
        vendor: vendorId.toString(),
        shareholderId: shareholderId.toString(),
      })
      .set(auth());

    expect(response.status).toBe(200);
    expect(models.VendorLedger.distinct).toHaveBeenCalledWith('orderId', {
      vendorId: vendorId.toString(), entryType: 'SALE',
    });
    const filter = models.Order.find.mock.calls[0][0];
    expect(filter).toMatchObject({
      outlet: outletId.toString(),
      cashier: cashierId.toString(),
      memberId: shareholderId.toString(),
      'payments.method': 'CARD',
      _id: { $in: [orderId] },
    });
    expect(filter.$and[0].$or[0].soldAt.$gte.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(filter.$and[0].$or[0].soldAt.$lt.toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  it('returns the cashier name in sales history bill details', async () => {
    const cashierOrder = {
      ...db.order,
      cashier: { _id: cashierId, name: 'Cashier Name' },
      lines: [{ productId, quantity: 2, total: 200, packageUnitName: 'Box' }],
    };
    const orderQuery = query([cashierOrder]);
    models.Order.find.mockReturnValue(orderQuery);

    const response = await request(app).get('/api/pos/history').set(auth());

    expect(response.status).toBe(200);
    expect(orderQuery.populate).toHaveBeenCalledWith('cashier', 'name');
    expect(response.body.orders[0].cashier).toMatchObject({ name: 'Cashier Name' });
  });

  it('audits every receipt reprint with the actor and order', async () => {
    const first = await request(app).post(`/api/pos/${orderId}/receipt`)
      .query({ selectedOutletId: outletId.toString() }).set(auth());
    const second = await request(app).post(`/api/pos/${orderId}/receipt`)
      .query({ selectedOutletId: outletId.toString() }).set(auth());

    expect(first.status).toBe(200);
    expect(first.body.order.orderNumber).toBe('POS-1');
    expect(second.status).toBe(200);
    expect(db.audits).toHaveLength(2);
    expect(db.audits[0]).toMatchObject({
      actorId: cashierId,
      action: 'REPRINT',
      entity: 'Order',
      entityId: orderId,
      metadata: { orderNumber: 'POS-1' },
    });
    expect(db.audits[0].createdAt).toBeInstanceOf(Date);
  });

  it('allows receipt reprints only within the user location scope', async () => {
    db.order.outlet = otherOutletId;
    const locked = await request(app).post(`/api/pos/${orderId}/receipt`)
      .query({ selectedOutletId: otherOutletId.toString() }).set(auth());

    expect(locked.status).toBe(404);
    expect(models.Order.findOne).toHaveBeenLastCalledWith({
      _id: orderId.toString(),
      outlet: outletId,
    });
    expect(db.audits).toHaveLength(0);

    user = {
      ...user,
      roleId: { name: 'Team', permissions: ['pos:read'], canViewAllLocations: true },
    };
    const allowed = await request(app).post(`/api/pos/${orderId}/receipt`)
      .query({ selectedOutletId: otherOutletId.toString() }).set(auth());
    expect(allowed.status).toBe(200);
    expect(db.audits).toHaveLength(1);
    expect(db.audits[0].entityId).toBe(orderId);
  });

  it('returns a full bill with stock restoration and exact vendor-ledger reversal', async () => {
    const response = await request(app).post(`/api/pos/${orderId}/return`).set(auth()).send({});

    expect(response.status).toBe(200);
    expect(response.body.return).toMatchObject({
      orderId: orderId.toString(),
      refundAmount: 200,
      walletRefunded: false,
    });
    expect(db.order.paymentStatus).toBe('REFUNDED');
    expect(db.returns[0].lines).toEqual([{ productId, quantity: 2, amount: 200 }]);
    expect(db.movements).toEqual([expect.objectContaining({
      productId, warehouseId: outletId, quantity: 2, type: 'RETURN',
    })]);
    expect(db.ledgers[1]).toMatchObject({
      vendorId, orderId, returnId: db.returns[0]._id, productId,
      quantity: 2, entryType: 'RETURN', vendorPayable: 120, companyNet: -80,
      locationId: outletId,
    });

    expect(db.audits).toHaveLength(1);
    expect(session.endSession).toHaveBeenCalled();
  });

  it('prevents a locked user from reading or returning another outlet bill', async () => {
    db.order.outlet = otherOutletId;
    const history = await request(app).get('/api/pos/history')
      .query({ selectedOutletId: otherOutletId.toString() }).set(auth());
    const emptyLocation = await request(app).get('/api/pos/history?selectedOutletId=').set(auth());
    const returned = await request(app).post(`/api/pos/${orderId}/return`).set(auth()).send({});

    expect(history.status).toBe(200);
    expect(emptyLocation.status).toBe(200);
    expect(history.body.orders).toEqual([]);
    expect(models.Order.find).toHaveBeenCalledWith(expect.objectContaining({ outlet: outletId }));
    expect(returned.status).toBe(403);
    expect(returned.body.message).toMatch(/selected outlet/i);
    expect(models.Return.create).not.toHaveBeenCalled();
    expect(models.StockMovement.create).not.toHaveBeenCalled();
  });

  it('lets an opted-in role query any outlet or all sales but still locks bill returns', async () => {
    user = {
      ...user,
      roleId: { name: 'Team', permissions: ['pos:read', 'pos:write'], canViewAllLocations: true },
    };
    const selected = await request(app).get('/api/pos/history')
      .query({ selectedOutletId: otherOutletId.toString() }).set(auth());
    expect(selected.status).toBe(200);
    expect(models.Order.find).toHaveBeenCalledWith(expect.objectContaining({ outlet: otherOutletId.toString() }));

    models.Order.find.mockClear();
    const all = await request(app).get('/api/pos/history').set(auth());
    expect(all.status).toBe(200);
    expect(models.Order.find).toHaveBeenCalledWith(expect.objectContaining({
      outlet: { $in: [outletId, otherOutletId] },
    }));
    const emptyLocation = await request(app).get('/api/pos/history?selectedOutletId=').set(auth());
    expect(emptyLocation.status).toBe(200);
    expect(models.Order.find).toHaveBeenLastCalledWith(expect.objectContaining({
      outlet: { $in: [outletId, otherOutletId] },
    }));

    db.order.outlet = otherOutletId;
    const returned = await request(app).post(`/api/pos/${orderId}/return`)
      .query({ selectedOutletId: otherOutletId.toString() }).set(auth()).send({});
    expect(returned.status).toBe(403);
    expect(models.Return.create).not.toHaveBeenCalled();
  });

  it('blocks a second return without posting duplicate stock or ledger entries', async () => {
    const first = await request(app).post(`/api/pos/${orderId}/return`).set(auth()).send({});
    const second = await request(app).post(`/api/pos/${orderId}/return`).set(auth()).send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(db.returns).toHaveLength(1);
    expect(db.movements).toHaveLength(1);
    expect(db.ledgers).toHaveLength(2);
    expect(db.audits).toHaveLength(1);
  });

  it('records wallet refund method and matching wallet refund log when reversal is confirmed', async () => {
    db.order.payments = [{ method: 'WALLET', amount: 200 }];
    const response = await request(app).post(`/api/pos/${orderId}/return`).set(auth()).send({
      walletRefunded: true,
      walletRefundMethod: 'API',
    });

    expect(response.status).toBe(200);
    expect(db.returns[0]).toMatchObject({ walletRefunded: true, walletRefundMethod: 'API' });
    expect(db.walletLogs).toEqual([expect.objectContaining({
      memberId: shareholderId, orderId, amount: 200, type: 'REFUND',
    })]);
  });
});
