const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  AuditLog, Location, Order, Product, Return, StockMovement, VendorLedger, WalletLog,
} = require('../models');
const { unitLabelMap, displayFields } = require('../utils/productDisplay');
const { statusError } = require('./posBillService');

function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function objectOf(value) {
  return value?.toObject ? value.toObject() : value;
}

function dateClause(query) {
  let start;
  let end;
  if (query.date) {
    start = new Date(`${query.date}T00:00:00.000Z`);
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  } else {
    if (query.from) start = new Date(query.from);
    if (query.to) {
      end = new Date(query.to);
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
        end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
      }
    }
  }
  if (!start && !end) return null;

  const saleDate = {};
  if (start) saleDate.$gte = start;
  if (end) {
    saleDate[/^\d{4}-\d{2}-\d{2}$/.test(query.to || '') || query.date ? '$lt' : '$lte'] = end;
  }
  return {
    $or: [
      { soldAt: saleDate },
      { soldAt: { $exists: false }, createdAt: saleDate },
      { soldAt: null, createdAt: saleDate },
    ],
  };
}

async function addHistoricalUnitNames(orders) {
  orders.forEach((order) => {
    delete order.walletVerification;
    delete order.walletVerificationReason;
    delete order.walletVerificationCheckedAt;
  });
  const missing = orders.flatMap((order) => order.lines).filter((line) => !line.packageUnitName);
  if (!missing.length) return orders;
  const products = await Product.find({ _id: { $in: missing.map((line) => line.productId) } })
    .select('unitId').lean();
  const labels = await unitLabelMap(products);
  const names = new Map(products.map((product) => [
    product._id.toString(), displayFields(product, labels).packageUnitName,
  ]));
  missing.forEach((line) => {
    const name = names.get(String(line.productId));
    if (name) line.packageUnitName = name;
  });
  return orders;
}

async function listSalesHistory(req) {
  const { query } = req;
  const filter = {};
  const clauses = [];

  if (req.locationId) {
    filter.outlet = req.locationId;
  } else {
    const activeOutlets = await Location.find({
      type: 'OUTLET',
      isActive: { $ne: false },
    }).select('_id').lean();
    filter.outlet = { $in: activeOutlets.map((location) => location._id) };
  }
  if (query.cashier) filter.cashier = query.cashier;
  if (query.shareholderId) filter.memberId = query.shareholderId;
  if (query.paymentMethod) filter['payments.method'] = query.paymentMethod;

  if (query.vendor) {
    const orderIds = await VendorLedger.distinct('orderId', {
      vendorId: query.vendor,
      entryType: 'SALE',
    });
    if (!orderIds.length) return [];
    filter._id = { $in: orderIds };
  }
  const dates = dateClause(query);
  if (dates) clauses.push(dates);
  if (clauses.length) filter.$and = clauses;

  const orders = await Order.find(filter)
    .populate('cashier', 'name')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return addHistoricalUnitNames(orders);
}

async function auditReceiptReprint(req) {
  const order = await Order.findOne({
    _id: req.params.orderId,
    outlet: req.locationId,
  }).populate('cashier', 'name').lean();
  if (!order) throw statusError('POS bill was not found', 404);

  await addHistoricalUnitNames([order]);
  await AuditLog.create([{
    actorId: req.user._id,
    action: 'REPRINT',
    entity: 'Order',
    entityId: order._id,
    createdAt: new Date(),
    metadata: { orderNumber: order.orderNumber },
    ipAddress: req.ip,
  }]);
  return order;
}

async function returnBill(req) {
  let session;
  try {
    session = await mongoose.startSession();
    let returnRecord;
    await session.withTransaction(async () => {
      const order = await Order.findById(req.params.orderId).session(session).lean();
      if (!order) throw statusError('POS bill was not found', 404);
      if (order.outlet.toString() !== req.locationId.toString()) {
        throw statusError('Bill returns are limited to the selected outlet', 403);
      }
      if (order.paymentStatus !== 'PAID') {
        throw statusError('Bill has already been returned', 409);
      }

      const existingReturn = await Return.findOne({ orderId: order._id }).session(session).lean();
      if (existingReturn) throw statusError('Bill has already been returned', 409);

      const walletSale = order.payments.some((payment) => payment.method === 'WALLET');
      const walletRefunded = req.body.walletRefunded === true;
      if (walletRefunded && !walletSale) {
        throw statusError('Wallet refund status only applies to wallet-paid bills', 400);
      }

      const saleLedgers = await VendorLedger.find({
        orderId: order._id,
        entryType: 'SALE',
      }).session(session).lean();
      const createdReturn = (await Return.create([{
        returnNumber: `RET-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        orderId: order._id,
        lines: order.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          amount: money(line.total),
        })),
        refundAmount: money(order.grandTotal),
        walletRefunded,
        ...(walletRefunded ? { walletRefundMethod: req.body.walletRefundMethod } : {}),
        createdBy: req.user._id,
      }], { session }))[0];
      returnRecord = createdReturn;

      const quantities = new Map();
      order.lines.forEach((line) => {
        const productId = line.productId.toString();
        quantities.set(productId, (quantities.get(productId) || 0) + line.quantity);
      });
      await StockMovement.create([...quantities].map(([productId, quantity]) => ({
        productId: new mongoose.Types.ObjectId(productId),
        warehouseId: order.outlet,
        quantity,
        type: 'RETURN',
        userId: req.user._id,
        referenceId: createdReturn._id,
        referenceType: 'Return',
      })), { session });

      if (saleLedgers.length) {
        await VendorLedger.create(saleLedgers.map((ledger) => ({
          vendorId: ledger.vendorId,
          orderId: order._id,
          locationId: order.outlet,
          returnId: createdReturn._id,
          productId: ledger.productId,
          quantity: ledger.quantity,
          entryType: 'RETURN',
          vendorPayable: money(ledger.vendorPayable),
          companyNet: money(-ledger.companyNet),
        })), { session });
      }
      if (walletRefunded) {
        await WalletLog.create([{
          memberId: order.memberId,
          orderId: order._id,
          amount: money(order.grandTotal),
          type: 'REFUND',
        }], { session });
      }

      const updatedOrder = await Order.findOneAndUpdate(
        { _id: order._id, paymentStatus: 'PAID' },
        { $set: { paymentStatus: 'REFUNDED' } },
        { new: true, runValidators: true, session },
      );
      if (!updatedOrder) throw statusError('Bill has already been returned', 409);

      await AuditLog.create([{
        actorId: req.user._id,
        action: 'RETURN',
        entity: 'Order',
        entityId: order._id,
        before: objectOf(order),
        after: objectOf(updatedOrder),
        metadata: {
          returnId: createdReturn._id,
          refundAmount: money(order.grandTotal),
          walletRefunded,
          walletRefundMethod: req.body.walletRefundMethod,
        },
        ipAddress: req.ip,
      }], { session });
    });
    return returnRecord;
  } catch (error) {
    if (error.code === 11000) throw statusError('Bill has already been returned', 409);
    throw error;
  } finally {
    if (session) await session.endSession();
  }
}

module.exports = { auditReceiptReprint, listSalesHistory, returnBill };
