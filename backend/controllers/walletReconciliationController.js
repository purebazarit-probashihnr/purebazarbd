const { AuditLog, Order, WalletReconciliation } = require('../models');
const service = require('../services/walletReconciliationService');
const offlineWalletVerificationService = require('../services/offlineWalletVerificationService');

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

const today = () => service.dhakaDate(new Date());

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
    const [orders, pending, verified, mismatch, notFound, unverifiable] = await Promise.all([
      Order.find(filter).populate('cashier', 'name').sort({ soldAt: -1, createdAt: -1 }).limit(200).lean(),
      Order.countDocuments({ ...filter, walletVerification: 'pending' }),
      Order.countDocuments({ ...filter, walletVerification: 'verified' }),
      Order.countDocuments({ ...filter, walletVerification: 'mismatch' }),
      Order.countDocuments({ ...filter, walletVerification: 'not_found' }),
      Order.countDocuments({ ...filter, walletVerification: 'unverifiable' }),
    ]);
    res.json({
      orders,
      totals: {
        pending, verified, mismatch, notFound, unverifiable,
        flagged: mismatch + notFound + unverifiable,
      },
    });
  } catch (error) { next(error); }
}

async function verifyOfflineWalletBill(req, res, next) {
  try {
    const filter = { _id: req.params.id, walletOffline: true };
    if (req.locationId) filter.outlet = req.locationId;
    const order = await Order.findOne(filter).select('_id');
    if (!order) throw statusError('Offline wallet bill was not found', 404);
    const updated = await offlineWalletVerificationService.verifyOfflineWalletOrder(order._id, {
      actorId: req.user._id,
      ipAddress: req.ip,
    });
    res.json({ order: updated });
  } catch (error) { next(error); }
}

module.exports = {
  list, listOfflineWalletBills, resolve, run, verifyOfflineWalletBill,
};
