const { AuditLog, Order } = require('../models');
const probashiWalletService = require('./probashiWalletService');

const DAY_MS = 24 * 60 * 60 * 1000;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const cents = (value) => Math.round(Number(value) * 100);
const dhakaDate = (value) => new Date(new Date(value).getTime() + DHAKA_OFFSET_MS)
  .toISOString().slice(0, 10);

function dayRange(date) {
  const start = new Date(`${date}T00:00:00+06:00`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

async function verifyOfflineWalletOrder(orderId, audit = {}) {
  const order = await Order.findById(orderId);
  if (!order || order.walletOffline !== true) {
    const error = new Error('Offline wallet bill was not found');
    error.status = 404;
    throw error;
  }
  const before = order.toObject ? order.toObject() : { ...order };
  let state = 'pending';
  let reason;
  try {
    const member = await probashiWalletService.verifyMember({ memberId: order.walletMemberId });
    if (!member.valid) {
      state = 'not_found';
      reason = 'Probashi could not verify this member ID.';
    } else if (!member.active || !member.walletEnabled) {
      state = 'mismatch';
      reason = 'The verified member is inactive or wallet-disabled.';
    } else if (member.memberId !== order.walletMemberId) {
      state = 'mismatch';
      reason = 'Probashi returned a different member ID.';
    } else {
      const { start, end } = dayRange(dhakaDate(order.soldAt || order.createdAt));
      const report = await probashiWalletService.getTransactionReport({
        memberId: order.walletMemberId,
        from: start.toISOString(),
        to: end.toISOString(),
      });
      const transactions = report.transactions || [];
      const referenceHit = transactions.find((transaction) => (
        String(transaction.transactionId || '') === order.walletReference
      ));
      if (referenceHit && cents(referenceHit.amount) === cents(order.grandTotal)) {
        state = 'verified';
        reason = 'Probashi member and transaction reference verified.';
      } else if (referenceHit) {
        state = 'mismatch';
        reason = `Probashi transaction amount ${Number(referenceHit.amount).toFixed(2)} does not match bill amount ${Number(order.grandTotal).toFixed(2)}.`;
      } else if (transactions.length) {
        state = 'mismatch';
        reason = 'Probashi report contains transactions, but not the supplied reference.';
      } else {
        state = 'not_found';
        reason = 'No matching Probashi transaction was found.';
      }
    }
  } catch (error) {
    reason = `Verification unavailable: ${error.message}`;
  }
  order.walletVerification = state;
  order.walletVerificationReason = reason;
  order.walletVerificationCheckedAt = new Date();
  await order.save();
  await AuditLog.create({
    actorId: audit.actorId,
    action: 'WALLET_VERIFY',
    entity: 'Order',
    entityId: order._id,
    before,
    after: order.toObject ? order.toObject() : order,
    ipAddress: audit.ipAddress,
    metadata: { walletVerification: state, reason },
  });
  return order;
}

module.exports = { verifyOfflineWalletOrder };
