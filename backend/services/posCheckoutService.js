const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  AuditLog, DiscountLog, Order, StockMovement, VendorLedger,
  WalletAuditLog, WalletLog,
} = require('../models');
const {
  billOutput, loadBill, receiptData, statusError,
} = require('./posBillService');
const { unitLabelMap, displayFields } = require('../utils/productDisplay');
const probashiWalletService = require('./probashiWalletService');
const offlineWalletVerificationService = require('./offlineWalletVerificationService');

function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatAvailableStock(quantity, product, packageUnitName) {
  const unitsPerPackage = Number(product.unitsPerPackage);
  if (!Number.isInteger(unitsPerPackage) || unitsPerPackage <= 1) {
    return `${quantity} ${packageUnitName || 'Box'}`;
  }
  const totalPieces = Math.max(0, Math.round(quantity * unitsPerPackage));
  const packages = Math.floor(totalPieces / unitsPerPackage);
  const pieces = totalPieces % unitsPerPackage;
  const parts = [];
  if (packages || !pieces) parts.push(`${packages} ${packageUnitName || 'Box'}`);
  if (pieces) parts.push(`${pieces} Pcs`);
  return parts.join(' and ');
}

function objectOf(value) {
  return value?.toObject ? value.toObject() : value;
}

function validatePayments(result, offline = false, deferredWallet = false) {
  const payments = result.payments;
  if (result.wallet && !deferredWallet) {
    payments[0].amount = result.bill.grandTotal;
  }
  if (payments.some((payment) => !Number.isFinite(payment.amount) || payment.amount <= 0)) {
    throw statusError('Every payment must have a positive amount');
  }
  if (!result.wallet || deferredWallet) {
    const total = money(payments.reduce((sum, payment) => sum + payment.amount, 0));
    if (total !== result.bill.grandTotal) throw statusError('Payments must equal the final bill total');
  }
  const allowed = {
    CASH: 'Cash', BKASH: 'bKash', NAGAD: 'Nagad', CARD: 'Card', WALLET: 'Wallet',
  };
  const enabled = result.settings.enabledPaymentMethods;
  if (!offline && enabled && payments.some((payment) => !enabled.includes(allowed[payment.method]))) {
    throw statusError('A selected payment method is disabled in Settings', 400);
  }
}

async function checkWallet(result, userId) {
  if (!result.wallet || !result.shareholder) return null;
  let balance;
  try {
    balance = await probashiWalletService.checkWalletBalance({
      memberId: result.shareholder.memberId,
      amount: result.bill.grandTotal,
    });
  } finally {
    await WalletAuditLog.create({
      memberId: result.shareholder.memberId,
      action: 'WALLET_BALANCE_CHECK',
      succeeded: Boolean(balance?.sufficient),
      createdBy: userId,
    });
  }
  return balance.sufficient;
}

async function existingOfflineOrder(offlineId) {
  return Order.findOne({ offlineId }).lean();
}
async function commitBill(req, res, next, offline) {
  let session;
  try {
    if (offline && !req.body.offlineId) throw statusError('offlineId is required for offline sync');
    if (!offline && req.body.offlineId) throw statusError('Use offline sync for queued bills');
    if (offline && req.body.offlineNumber) {
      const prefix = `OFF-${String(req.locationId).toUpperCase()}-`;
      if (!req.body.offlineNumber.startsWith(prefix)
        || !/^\d+$/.test(req.body.offlineNumber.slice(prefix.length))) {
        throw statusError('Offline bill number does not match the active outlet');
      }
    }
    if (offline) {
      const existing = await existingOfflineOrder(req.body.offlineId);
      if (existing) {
        return res.json({
          success: true,
          synced: true,
          duplicate: true,
          flagged: Boolean(existing.reviewRequired),
          reviewFlags: existing.reviewFlags || [],
          ...(existing.walletOffline && existing.walletVerification === 'pending'
            ? { walletPending: true, note: 'wallet pending' }
            : {}),
          order: existing,
          receipt: receiptData(existing),
        });
      }
    }
    const result = await loadBill(req.body, req.user);
    const deferredWallet = offline && result.wallet;
    if (deferredWallet && req.body.walletOffline !== true) {
      throw statusError('Wallet payments cannot be queued offline');
    }
    const walletMemberId = String(req.body.walletMemberId || '').trim();
    const walletReference = String(req.body.walletReference || '').trim();
    if (deferredWallet
      && result.settings.requireMemberIdAndReferenceForOfflineWallet === true
      && (!walletMemberId || !walletReference)) {
      throw statusError('Member ID and Probashi transaction reference are required for an offline wallet payment');
    }
    if (deferredWallet
      && result.bill.grandTotal > Number(result.settings.maximumOfflineWalletAmountPerBill ?? 2000)) {
      throw statusError(
        `Offline wallet payment is limited to ${Number(result.settings.maximumOfflineWalletAmountPerBill ?? 2000).toFixed(2)} per bill`,
      );
    }
    const hasWalletDetails = ['walletMemberId', 'walletReference'].some((field) => (
      Object.prototype.hasOwnProperty.call(req.body, field)
    ));
    if (!deferredWallet && (req.body.walletOffline || hasWalletDetails)) {
      throw statusError('Offline wallet details are only valid for a queued wallet payment');
    }
    if (result.approvalRequired && !result.approvedBy) {
      throw statusError('Discount exceeds this role limit; Super Admin approval is required', 403);
    }
    validatePayments(result, offline, deferredWallet);
    const sufficient = deferredWallet ? null : await checkWallet(result, req.user._id);
    if (sufficient === false) {
      const repriced = await loadBill({
        ...req.body,
        payments: req.body.payments.map((payment) => ({
          method: payment.method === 'WALLET' ? 'CASH' : payment.method,
        })),
        shareholderId: undefined,
      }, req.user, result.settings);
      return res.status(409).json({
        success: false,
        message: 'Insufficient wallet balance; the bill has been repriced at MRP',
        sufficient: false,
        bill: billOutput(repriced),
      });
    }

    const outletId = req.locationId;
    const orderNumber = offline
      ? (req.body.offlineNumber || `OFF-${String(outletId).toUpperCase()}-${Date.now()}`)
      : `POS-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const saleDate = new Date(req.body.soldAt || Date.now());
    const reviewFlags = [];
    if (offline && result.approvalRequired && !result.approvedBy) {
      reviewFlags.push('DISCOUNT_APPROVAL_REQUIRED');
    }
    const unitLabels = await unitLabelMap(result.lines.map(({ product }) => product));
    session = await mongoose.startSession();
    let order;
    await session.withTransaction(async () => {
      const quantities = new Map();
      result.lines.forEach(({ item, pricing }) => {
        quantities.set(item.productId, (quantities.get(item.productId) || 0) + pricing.stockQuantity);
      });
      const stock = await StockMovement.aggregate([
        {
          $match: {
            warehouseId: new mongoose.Types.ObjectId(String(outletId)),
            productId: { $in: [...quantities.keys()].map((id) => new mongoose.Types.ObjectId(id)) },
          },
        },
        { $group: { _id: '$productId', quantity: { $sum: '$quantity' } } },
      ]).session(session);
      const available = new Map(stock.map((item) => [item._id.toString(), item.quantity]));
      for (const [productId, quantity] of quantities) {
        // Tolerance absorbs floating point drift from fractional box deductions.
        const availableQuantity = available.get(productId) || 0;
        if (availableQuantity + 1e-9 < quantity && offline) {
          reviewFlags.push(`NEGATIVE_STOCK:${productId}`);
        } else if (availableQuantity + 1e-9 < quantity) {
          const product = result.lines.find(({ item }) => item.productId === productId)?.product;
          const { packageUnitName } = displayFields(product, unitLabels);
          const availableText = formatAvailableStock(availableQuantity, product, packageUnitName);
          throw statusError(
            `Insufficient outlet stock for ${product.name}. Available: ${availableText}`,
            409,
          );
        }
      }
      const [created] = await Order.create([{
        orderNumber,
        ...(offline ? {
          offlineId: req.body.offlineId,
          soldAt: saleDate,
          reviewRequired: reviewFlags.length > 0,
          reviewFlags,
        } : {}),
        ...(deferredWallet ? {
          walletOffline: true,
          ...(walletMemberId ? { walletMemberId } : {}),
          ...(walletReference ? { walletReference } : {}),
          walletVerification: 'pending',
        } : {}),
        channel: 'POS',
        lines: result.bill.ledgerLines.map((line, index) => {
          const { item, product, pricing } = result.lines[index];
          const { packageUnitName } = displayFields(product, unitLabels);
          return {
            productId: product._id,
            productName: product.name,
            barcode: product.barcode,
            quantity: line.quantity,
            unit: item.unit === 'PIECE' ? 'PIECE' : 'PACKAGE',
            ...(packageUnitName ? { packageUnitName } : {}),
            mrp: pricing.unitPrice,
            subtotal: line.subtotal,
            itemDiscountAmount: line.itemDiscountAmount,
            billDiscountAmount: line.billDiscountAmount,
            shareholderDiscountAmount: line.shareholderDiscountAmount,
            vatAmount: line.vatAmount,
            total: money(line.subtotal - line.discountAmount + line.vatAmount),
            ...(item.discount ? { discountReason: item.discount.reason } : {}),
          };
        }),
        subtotal: result.bill.subtotal,
        otherDiscountAmount: result.bill.otherDiscountAmount,
        otherDiscountReason: [...new Set([
          ...req.body.items.map((item) => item.discount?.reason),
          req.body.billDiscount?.reason,
        ].filter(Boolean))].join('; ') || undefined,
        shareholderDiscountAmount: result.bill.shareholderDiscountAmount,
        vatAmount: result.bill.vatAmount,
        grandTotal: result.bill.grandTotal,
        payments: result.payments,
        paymentStatus: 'PAID',
        ...(result.verifiedMember ? { memberId: result.shareholder._id } : {}),
        cashier: req.user._id,
        outlet: outletId,
      }], { session });
      order = created;
      await StockMovement.create([...quantities].map(([productId, quantity]) => ({
        productId,
        warehouseId: outletId,
        quantity: -quantity,
        type: 'SALE',
        userId: req.user._id,
        referenceId: created._id,
        referenceType: 'Order',
      })), { session, ordered: true });

      const ledgerRows = result.bill.ledgerLines.filter((line) => line.ownerType === 'VENDOR').map((line) => ({
        vendorId: line.vendorId,
        orderId: created._id,
        productId: line.productId,
        quantity: line.quantity,
        entryType: 'SALE',
        vendorPayable: line.vendorPayable,
        companyNet: line.companyNet,
        locationId: created.outlet,
      }));
      if (ledgerRows.length) await VendorLedger.create(ledgerRows, { session, ordered: true });
      if (result.wallet && result.shareholder) {
        await WalletLog.create([{
          memberId: result.shareholder._id,
          orderId: created._id,
          amount: result.bill.grandTotal,
          type: 'DEBIT',
        }], { session });
      }
      const discountRows = [];
      result.bill.ledgerLines.forEach((line, index) => {
        const discount = req.body.items[index].discount;
        if (line.itemDiscountAmount > 0) discountRows.push({
          orderId: created._id, productId: line.productId, scope: 'ITEM',
          discountType: discount.type, amount: line.itemDiscountAmount,
          reason: discount.reason, appliedBy: req.user._id,
          ...(result.approvedBy ? { approvedBy: result.approvedBy } : {}),
        });
      });
      const billDiscountAmount = money(
        result.bill.ledgerLines.reduce((sum, line) => sum + line.billDiscountAmount, 0),
      );
      if (billDiscountAmount > 0) discountRows.push({
        orderId: created._id, scope: 'BILL', discountType: req.body.billDiscount.type,
        amount: billDiscountAmount, reason: req.body.billDiscount.reason,
        appliedBy: req.user._id, ...(result.approvedBy ? { approvedBy: result.approvedBy } : {}),
      });
      if (result.bill.shareholderDiscountAmount > 0) discountRows.push({
        orderId: created._id, scope: 'BILL', discountType: 'FIXED',
        amount: result.bill.shareholderDiscountAmount,
        reason: 'Wallet payment discount', appliedBy: req.user._id,
      });
      if (discountRows.length) await DiscountLog.create(discountRows, { session, ordered: true });
      await AuditLog.create([{
        actorId: req.user._id,
        action: offline ? 'SYNC' : 'FINALIZE',
        entity: 'Order',
        entityId: created._id,
        after: objectOf(created),
        metadata: { offlineId: offline ? req.body.offlineId : undefined, approvedBy: result.approvedBy },
        ipAddress: req.ip,
      }], { session });
    });
    const output = objectOf(order);
    if (deferredWallet) {
      res.once('finish', () => {
        setImmediate(() => {
          offlineWalletVerificationService.verifyOfflineWalletOrder(order._id, {
            actorId: req.user._id,
            ipAddress: req.ip,
          }).catch((error) => {
            console.error(`Offline wallet verification failed for order ${order._id}:`, error);
          });
        });
      });
    }
    return res.status(offline ? 200 : 201).json({
      success: true,
      ...(offline ? {
        synced: true,
        duplicate: false,
        flagged: reviewFlags.length > 0,
        reviewFlags,
        ...(deferredWallet
          ? { walletPending: true, note: 'wallet pending' }
          : {}),
      } : {}),
      order: output,
      receipt: receiptData(output),
    });
  } catch (error) {
    if (offline && error.code === 11000) {
      try {
        const existing = await existingOfflineOrder(req.body.offlineId);
        if (existing) {
          return res.json({
            success: true,
            synced: true,
            duplicate: true,
            flagged: Boolean(existing.reviewRequired),
            reviewFlags: existing.reviewFlags || [],
            order: existing,
            receipt: receiptData(existing),
          });
        }
      } catch (lookupError) {
        return next(lookupError);
      }
    }
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
}

module.exports = {
  finalizeBill: (req, res, next) => commitBill(req, res, next, false),
  syncOfflineBill: (req, res, next) => commitBill(req, res, next, true),
};
