const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const request = require('supertest');

jest.mock('../models', () => {
  const { fakeModel } = require('./helpers/fakeModel');
  const store = [];
  return {
    AuditLog: { create: jest.fn() },
    User: { findById: jest.fn() },
    Order: { find: jest.fn(), aggregate: jest.fn(), countDocuments: jest.fn() },
    Shareholder: { find: jest.fn() },
    WalletReconciliation: fakeModel(jest.requireActual('../models/WalletReconciliation'), store),
    __store: store,
  };
});

const models = require('../models');
const probashi = require('../services/probashiWalletService');
const financeRoutes = require('../routes/financeRoutes');
const errorMiddleware = require('../middlewares/errorMiddleware');

const secret = 'wallet-recon-test-secret';
const userId = new mongoose.Types.ObjectId('65d000000000000000000001');
const locationId = new mongoose.Types.ObjectId('65d000000000000000000002');
const date = '2026-03-10';
const id = () => new mongoose.Types.ObjectId();

describe('wallet reconciliation API', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/finance', financeRoutes);
  app.use(errorMiddleware);
  const auth = { get Authorization() { return `Bearer ${jwt.sign({ sub: userId.toString() }, secret)}`; } };
  const member = { _id: id(), memberId: 'M-100' };
  let permissions;
  let report;

  const wallet = (orderNumber, amount, soldAt = `${date}T10:00:00+06:00`) => ({
    _id: id(), orderNumber, memberId: member._id, paymentStatus: 'PAID', soldAt: new Date(soldAt),
    payments: [{ method: 'WALLET', amount }],
  });
  const run = () => request(app).post('/api/finance/wallet-reconciliation/run').set(auth).send({ date });
  const byOrder = (res, number) => res.body.records.find((r) => r.orderNumber === number);

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    models.__store.length = 0;
    permissions = ['finance:read', 'finance:write'];
    models.AuditLog.create.mockReset().mockResolvedValue({});
    models.Order.aggregate.mockReset().mockResolvedValue([]);
    models.User.findById.mockImplementation(() => ({
      populate: jest.fn(async () => ({
        _id: userId,
        locationId,
        isActive: true,
        roleId: { _id: userId, name: 'Finance', permissions },
      })),
    }));
    models.Shareholder.find.mockReturnValue({ lean: async () => [member] });
    report = [];
    jest.spyOn(probashi, 'getTransactionReport').mockImplementation(async () => ({
      memberId: member.memberId, transactions: report,
    }));
  });

  afterEach(() => jest.restoreAllMocks());

  it('flags matched, missing and wrong-amount wallet bills', async () => {
    const orders = [wallet('B1', 100.5), wallet('B2', 200), wallet('B3', 300)];
    models.Order.find.mockReturnValue({ lean: async () => orders });
    report = [
      { transactionId: 'T1', amount: 100.5, date: `${date}T10:01:00+06:00` },
      { transactionId: 'T3', amount: 250, date: `${date}T11:00:00+06:00` },
      { transactionId: 'T9', amount: 300, date: '2026-03-09T10:00:00+06:00' },
    ];

    const res = await run();
    expect(res.status).toBe(200);
    expect(models.Order.find).toHaveBeenCalledWith(expect.objectContaining({
      'payments.method': 'WALLET',
      walletOffline: { $ne: true },
      paymentStatus: 'PAID',
    }));
    expect(byOrder(res, 'B1')).toMatchObject({ status: 'Matched', probashiTransactionId: 'T1' });
    expect(byOrder(res, 'B2')).toMatchObject({ status: 'Mismatch', mismatchType: 'AMOUNT_MISMATCH', probashiAmount: 250 });
    expect(byOrder(res, 'B3')).toMatchObject({ status: 'Mismatch', mismatchType: 'MISSING' });
    expect(res.body.totals).toMatchObject({ matched: 1, mismatch: 2, unresolved: 2 });
    expect(models.AuditLog.create).toHaveBeenCalled();
  });

  it('ignores bills without wallet payment lines and is idempotent', async () => {
    const orders = [wallet('B1', 50)];
    models.Order.find.mockReturnValue({ lean: async () => orders });
    report = [{ transactionId: 'T1', amount: 50, date: `${date}T09:00:00+06:00` }];
    await run();
    const res = await run();
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].status).toBe('Matched');
  });

  it('resolves a mismatch with a mandatory reason and keeps it on re-run', async () => {
    const orders = [wallet('B1', 80)];
    models.Order.find.mockReturnValue({ lean: async () => orders });
    const first = await run();
    const recordId = first.body.records[0]._id;

    expect((await request(app).post(`/api/finance/wallet-reconciliation/${recordId}/resolve`)
      .set(auth).send({})).status).toBe(400);
    const ok = await request(app).post(`/api/finance/wallet-reconciliation/${recordId}/resolve`)
      .set(auth).send({ reason: 'Probashi confirmed late posting' });
    expect(ok.status).toBe(200);
    expect(ok.body.record).toMatchObject({ resolved: true, resolutionReason: 'Probashi confirmed late posting' });
    expect((await request(app).post(`/api/finance/wallet-reconciliation/${recordId}/resolve`)
      .set(auth).send({ reason: 'again again' })).status).toBe(409);

    const rerun = await run();
    expect(rerun.body.totals.unresolved).toBe(0);
    const list = await request(app).get(`/api/finance/wallet-reconciliation?date=${date}`).set(auth);
    expect(list.body.records[0].resolved).toBe(true);
  });

  it('refuses to resolve matched records and enforces permissions', async () => {
    models.Order.find.mockReturnValue({ lean: async () => [wallet('B1', 50)] });
    report = [{ transactionId: 'T1', amount: 50, date: `${date}T09:00:00+06:00` }];
    const first = await run();
    expect((await request(app).post(`/api/finance/wallet-reconciliation/${first.body.records[0]._id}/resolve`)
      .set(auth).send({ reason: 'not needed' })).status).toBe(409);

    permissions = ['finance:read'];
    expect((await run()).status).toBe(403);
    expect((await request(app).get('/api/finance/wallet-reconciliation').set(auth)).status).toBe(200);
    expect((await request(app).post('/api/finance/wallet-reconciliation/run').set(auth).send({ date: '2999-01-01' })).status).toBe(403);
  });

  it('validates dates', async () => {
    expect((await request(app).post('/api/finance/wallet-reconciliation/run').set(auth).send({ date: 'nope' })).status).toBe(400);
    expect((await request(app).post('/api/finance/wallet-reconciliation/run').set(auth).send({ date: '2999-01-01' })).status).toBe(400);
  });

  it('lists offline wallet bills without verification status fields', async () => {
    const order = {
      _id: id(),
      orderNumber: 'OFF-WALLET',
      soldAt: new Date(`${date}T10:00:00+06:00`),
      createdAt: new Date(`${date}T10:00:00+06:00`),
      grandTotal: 125,
      payments: [{ method: 'WALLET', amount: 125 }],
      cashier: { name: 'Cashier' },
      outlet: { name: 'Outlet' },
      walletOffline: true,
      walletVerification: 'unverifiable',
      walletVerificationReason: 'No member ID or reference recorded',
    };
    const query = {
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: order._id,
        orderNumber: order.orderNumber,
        soldAt: order.soldAt,
        createdAt: order.createdAt,
        grandTotal: order.grandTotal,
        payments: order.payments,
        cashier: order.cashier,
        outlet: order.outlet,
      }]),
    };
    models.Order.find.mockReturnValue(query);

    const response = await request(app)
      .get(`/api/finance/wallet-reconciliation/offline?date=${date}`).set(auth);

    expect(response.status).toBe(200);
    expect(response.body.orders).toHaveLength(1);
    expect(response.body.orders[0]).toMatchObject({
      orderNumber: 'OFF-WALLET',
      grandTotal: 125,
      payments: [{ method: 'WALLET', amount: 125 }],
    });
    expect(response.body.orders[0]).not.toHaveProperty('walletVerification');
    expect(response.body).not.toHaveProperty('totals');
    expect(query.select).toHaveBeenCalledWith(
      'orderNumber soldAt createdAt grandTotal payments cashier outlet',
    );
    expect(models.Order.find).toHaveBeenCalledWith(expect.objectContaining({
      walletOffline: true,
      paymentStatus: 'PAID',
    }));
    expect(response.body.dateTotal).toMatchObject({ date, amount: 0 });
  });

  it('does not expose manual verification for offline wallet bills', async () => {
    const response = await request(app)
      .post(`/api/finance/wallet-reconciliation/offline/${id()}/verify`).set(auth);

    expect(response.status).toBe(404);
    expect(probashi.getTransactionReport).not.toHaveBeenCalled();
  });

  it('hides legacy offline wallet rows from online reconciliation results', async () => {
    const offlineOrder = { ...wallet('OFF-OLD', 125), walletOffline: true };
    await models.WalletReconciliation.create({
      businessDate: date,
      orderId: offlineOrder._id,
      orderNumber: offlineOrder.orderNumber,
      memberId: member.memberId,
      amount: 125,
    });
    models.Order.find.mockImplementation((filter) => ({
      lean: async () => (filter.walletOffline ? [offlineOrder] : []),
    }));

    const response = await request(app)
      .get(`/api/finance/wallet-reconciliation?date=${date}`).set(auth);

    expect(response.status).toBe(200);
    expect(response.body.records).toEqual([]);
    expect(response.body.totals).toMatchObject({ matched: 0, mismatch: 0, pending: 0 });
    expect(probashi.getTransactionReport).not.toHaveBeenCalled();
  });

  it('totals offline wallet bills for the selected business date', async () => {
    models.Order.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    models.Order.countDocuments.mockResolvedValue(0);
    models.Order.aggregate.mockResolvedValue([{ _id: null, count: 2, amountCents: 12505 }]);

    const response = await request(app)
      .get(`/api/finance/wallet-reconciliation/offline?date=${date}`)
      .set(auth);

    expect(response.status).toBe(200);
    expect(response.body.dateTotal).toEqual({ date, count: 2, amount: 125.05 });
    const [pipeline] = models.Order.aggregate.mock.calls[0];
    expect(pipeline[0].$match).toMatchObject({
      walletOffline: true,
      paymentStatus: 'PAID',
      $or: [
        { soldAt: { $gte: new Date(`${date}T00:00:00+06:00`), $lt: new Date('2026-03-10T18:00:00.000Z') } },
        expect.objectContaining({ soldAt: { $exists: false } }),
      ],
    });
  });
});
