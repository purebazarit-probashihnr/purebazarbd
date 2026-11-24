const mongoose = require('mongoose');
const {
  AuditLog, Location, Product, StockMovement, StockTransfer,
} = require('../models');
const { isSuperAdmin } = require('../utils/locationScope');
const {
  loadScopedTransfer, locationFilter, statusError, transferOutputs,
} = require('../services/stockTransferService');

function canManageSource(req, locationId) {
  return isSuperAdmin(req.user)
    || Boolean(req.locationId && req.locationId.toString() === locationId.toString());
}

function canReceive(req, locationId) {
  return isSuperAdmin(req.user)
    || (req.user.canViewAllLocations
      && req.user.permissions.includes('stock:transfer:receive'))
    || Boolean(req.locationId && req.locationId.toString() === locationId.toString());
}

function normalizeRequestedLines(lines) {
  const combined = new Map();
  for (const line of lines) {
    const productId = line.productId.toString();
    combined.set(productId, (combined.get(productId) || 0) + Number(line.requestedQuantity));
  }
  return [...combined].map(([productId, requestedQuantity]) => ({ productId, requestedQuantity }));
}

async function createTransfer(req, res, next) {
  let session;
  try {
    const { fromWarehouseId, toWarehouseId } = req.body;
    if (!canManageSource(req, fromWarehouseId)) {
      throw statusError('You can only create transfers from your assigned warehouse', 403);
    }
    if (fromWarehouseId === toWarehouseId) throw statusError('Transfer locations must be different', 400);

    const [from, to] = await Promise.all([
      Location.findById(fromWarehouseId).lean(),
      Location.findById(toWarehouseId).lean(),
    ]);
    if (!from || from.isActive === false || from.type !== 'CENTRAL'
      || !to || to.isActive === false || to.type !== 'OUTLET') {
      throw statusError('Transfers must move stock from a central warehouse to an outlet', 400);
    }

    const lines = normalizeRequestedLines(req.body.lines);
    const products = await Product.find({ _id: { $in: lines.map(({ productId }) => productId) } })
      .select('_id name').lean();
    if (products.length !== lines.length) throw statusError('One or more products were not found', 400);
    const productsById = new Map(products.map((product) => [product._id.toString(), product]));

    session = await mongoose.startSession();
    let output;
    await session.withTransaction(async () => {
      const available = await StockMovement.aggregate([
        {
          $match: {
            warehouseId: new mongoose.Types.ObjectId(fromWarehouseId),
            productId: { $in: lines.map((line) => new mongoose.Types.ObjectId(line.productId)) },
          },
        },
        { $group: { _id: '$productId', quantity: { $sum: '$quantity' } } },
      ]).session(session);
      const stockByProduct = new Map(available.map(({ _id, quantity }) => [_id.toString(), quantity]));
      for (const line of lines) {
        const stockQuantity = stockByProduct.get(line.productId) || 0;
        if (line.requestedQuantity > stockQuantity) {
          const productName = productsById.get(line.productId)?.name || 'A product';
          throw statusError(
            `${productName}: requested quantity exceeds the ${stockQuantity} units available in the Central Warehouse`,
            409,
          );
        }
      }
      const [transfer] = await StockTransfer.create([{
        fromWarehouseId,
        toWarehouseId,
        lines,
        createdBy: req.user._id,
      }], { session });
      await AuditLog.create([{
        actorId: req.user._id,
        action: 'CREATE',
        entity: 'StockTransfer',
        entityId: transfer._id,
        after: transfer.toObject(),
        ipAddress: req.ip,
      }], { session });
      [output] = await transferOutputs([transfer]);
    });
    return res.status(201).json({ success: true, stockTransfer: output });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
}

async function listTransfers(req, res, next) {
  try {
    const filter = locationFilter(req);
    if (req.query.status) filter.status = req.query.status;
    const transfers = await StockTransfer.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, stockTransfers: await transferOutputs(transfers) });
  } catch (error) {
    return next(error);
  }
}

async function getTransfer(req, res, next) {
  try {
    const transfer = await loadScopedTransfer(req.params.id, req);
    const [output] = await transferOutputs([transfer]);
    return res.json({ success: true, stockTransfer: output });
  } catch (error) {
    return next(error);
  }
}

async function dispatchTransfer(req, res, next) {
  let session;
  try {
    session = await mongoose.startSession();
    let output;
    await session.withTransaction(async () => {
      const transfer = await loadScopedTransfer(req.params.id, req, session);
      if (!canManageSource(req, transfer.fromWarehouseId)) {
        throw statusError('Only the source warehouse can dispatch this transfer', 403);
      }
      if (transfer.status !== 'Requested') throw statusError('Only requested transfers can be dispatched', 409);
      const quantities = new Map(req.body.lines.map((line) => [
        line.productId.toString(), Number(line.dispatchedQuantity),
      ]));
      const productIds = transfer.lines.map((line) => line.productId.toString());
      if (quantities.size !== productIds.length || productIds.some((id) => !quantities.has(id))) {
        throw statusError('Dispatch quantities must include every transfer product exactly once', 400);
      }
      const available = await StockMovement.aggregate([
        { $match: { warehouseId: transfer.fromWarehouseId, productId: { $in: transfer.lines.map((line) => line.productId) } } },
        { $group: { _id: '$productId', quantity: { $sum: '$quantity' } } },
      ]).session(session);
      const stockByProduct = new Map(available.map(({ _id, quantity }) => [_id.toString(), quantity]));
      for (const line of transfer.lines) {
        const quantity = quantities.get(line.productId.toString());
        if (quantity > (stockByProduct.get(line.productId.toString()) || 0)) {
          throw statusError('Insufficient stock to dispatch this transfer', 409);
        }
        line.dispatchedQuantity = quantity;
      }
      if (![...quantities.values()].some((quantity) => quantity > 0)) {
        throw statusError('At least one product must be dispatched', 400);
      }

      const before = transfer.toObject();
      transfer.status = 'Dispatched';
      transfer.dispatchedBy = req.user._id;
      transfer.dispatchedAt = new Date();
      transfer.carrierName = req.body.carrierName.trim();
      transfer.carrierPhone = req.body.carrierPhone.trim();
      transfer.vehicle = req.body.vehicle?.trim() || '';
      transfer.notes = req.body.notes?.trim() || '';
      await transfer.save({ session });
      const movements = transfer.lines
        .filter((line) => line.dispatchedQuantity > 0)
        .map((line) => ({
          productId: line.productId,
          warehouseId: transfer.fromWarehouseId,
          quantity: -line.dispatchedQuantity,
          type: 'TRANSFER_OUT',
          userId: req.user._id,
          reason: `Stock transfer ${transfer._id}`,
          referenceId: transfer._id,
          referenceType: 'StockTransfer',
        }));
      await StockMovement.create(movements, { session, ordered: true });
      await AuditLog.create([{
        actorId: req.user._id,
        action: 'DISPATCH',
        entity: 'StockTransfer',
        entityId: transfer._id,
        before,
        after: transfer.toObject(),
        ipAddress: req.ip,
      }], { session });
      [output] = await transferOutputs([transfer]);
    });
    return res.json({ success: true, stockTransfer: output });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
}

async function receiveTransfer(req, res, next) {
  let session;
  try {
    session = await mongoose.startSession();
    let output;
    await session.withTransaction(async () => {
      const transfer = await loadScopedTransfer(req.params.id, req, session, {
        allowAllLocationReceipt: true,
      });
      if (!canReceive(req, transfer.toWarehouseId)) {
        throw statusError('Only the receiving outlet can confirm this transfer', 403);
      }
      if (transfer.status !== 'Dispatched') throw statusError('Only dispatched transfers can be received', 409);
      const quantities = new Map(req.body.lines.map((line) => [
        line.productId.toString(), Number(line.receivedQuantity),
      ]));
      const productIds = transfer.lines.map((line) => line.productId.toString());
      if (quantities.size !== productIds.length || productIds.some((id) => !quantities.has(id))) {
        throw statusError('Received quantities must include every transfer product exactly once', 400);
      }

      const before = transfer.toObject();
      let discrepancy = false;
      for (const line of transfer.lines) {
        line.receivedQuantity = quantities.get(line.productId.toString());
        line.discrepancyQuantity = Math.abs(line.dispatchedQuantity - line.receivedQuantity);
        if (line.discrepancyQuantity > 0.000000001) discrepancy = true;
      }
      transfer.status = discrepancy ? 'Discrepancy' : 'Received';
      transfer.receivedBy = req.user._id;
      transfer.receivedAt = new Date();
      await transfer.save({ session });
      const movements = transfer.lines
        .filter((line) => line.receivedQuantity > 0)
        .map((line) => ({
          productId: line.productId,
          warehouseId: transfer.toWarehouseId,
          quantity: line.receivedQuantity,
          type: 'TRANSFER_IN',
          userId: req.user._id,
          reason: `Stock transfer ${transfer._id}`,
          referenceId: transfer._id,
          referenceType: 'StockTransfer',
        }));
      if (movements.length) await StockMovement.create(movements, { session, ordered: true });
      await AuditLog.create([{
        actorId: req.user._id,
        action: 'RECEIVE',
        entity: 'StockTransfer',
        entityId: transfer._id,
        before,
        after: transfer.toObject(),
        metadata: { confirmedBy: req.user._id, destination: transfer.toWarehouseId },
        ipAddress: req.ip,
      }], { session });
      [output] = await transferOutputs([transfer]);
    });
    return res.json({ success: true, stockTransfer: output });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
}

module.exports = {
  createTransfer, listTransfers, getTransfer, dispatchTransfer, receiveTransfer,
};
