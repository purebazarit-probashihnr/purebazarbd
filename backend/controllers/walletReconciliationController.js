const { AuditLog, Order, WalletReconciliation } = require('../models');
const service = require('../services/walletReconciliationService');

const DAY_MS = 24 * 60 * 60 * 1000;

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const today = () => service.dhakaDate(new Date());

function offlineWalletDateRange(date) {
  const start = new Date(`${date}T00:00:00+06:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

async function list(req, res, next) {
  try {
    res.json(await service.summarize(req.query.date || today()));
  } catch (error) { next(error); }
}

async function run(req, res, next) {
  try {
    const date = req.body.date || today();
    if (date > today()) throw statusError('Cannot reconcile a future date', 400);
    const result = await service.reconcileDate(date);
    await AuditLog.create({
      actorId: req.user._id,
      action: 'CREATE',
      entity: 'WalletReconciliation',
      after: result.totals,
      ipAddress: req.ip,
      metadata: { date },
    });
    res.json(result);
  } catch (error) { next(error); }
}

async function resolve(req, res, next) {
  try {
    const record = await WalletReconciliation.findById(req.params.id);
    if (!record) throw statusError('Reconciliation record not found', 404);
    if (record.status !== 'Mismatch') throw statusError('Only mismatches can be resolved', 409);
    if (record.resolved) throw statusError('This mismatch is already resolved', 409);
    const before = record.toObject();
    record.resolved = true;
    record.resolutionReason = req.body.reason;
    record.resolvedBy = req.user._id;
    record.resolvedAt = new Date();
    await record.save();
    await AuditLog.create({
      actorId: req.user._id,
      action: 'UPDATE',
      entity: 'WalletReconciliation',
      entityId: record._id,
      before,
      after: record.toObject(),
      ipAddress: req.ip,
      metadata: { changedFields: ['resolved', 'resolutionReason', 'resolvedBy', 'resolvedAt'] },
    });
    res.json({ record });
  } catch (error) { next(error); }
}

async function listOfflineWalletBills(req, res, next) {
  try {
    const filter = { walletOffline: true };
    if (req.locationId) filter.outlet = req.locationId;
    const dateFilter = req.query.date ? offlineWalletDateRange(req.query.date) : null;
    const dateMatch = dateFilter ? {
      ...filter,
      paymentStatus: 'PAID',
      $or: [
        { soldAt: { $gte: dateFilter.start, $lt: dateFilter.end } },
        {
          soldAt: { $exists: false },
          createdAt: { $gte: dateFilter.start, $lt: dateFilter.end },
        },
      ],
    } : null;
    const [orders, dateSummary] = await Promise.all([
      Order.find(dateMatch || filter).select('orderNumber soldAt createdAt grandTotal payments cashier outlet')
        .populate('cashier', 'name').populate('outlet', 'name')
        .sort({ soldAt: -1, createdAt: -1 }).limit(200).lean(),
      dateMatch ? Order.aggregate([
        { $match: dateMatch },
        { $unwind: '$payments' },
        { $match: { 'payments.method': 'WALLET' } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amountCents: {
              $sum: { $round: [{ $multiply: ['$payments.amount', 100] }, 0] },
            },
          },
        },
      ]) : Promise.resolve([]),
    ]);
    res.json({
      orders,
      dateTotal: {
        date: req.query.date || null,
        count: dateSummary?.[0]?.count || 0,
        amount: Math.round(Number(dateSummary?.[0]?.amountCents || 0)) / 100,
      },
    });
  } catch (error) { next(error); }
}

module.exports = {
  list, listOfflineWalletBills, resolve, run,
};
