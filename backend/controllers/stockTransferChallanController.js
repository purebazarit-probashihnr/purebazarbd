const mongoose = require('mongoose');
const { AuditLog, Settings } = require('../models');
const {
  canPrintChallan, loadScopedTransfer, statusError, transferNumber, transferOutputs,
} = require('../services/stockTransferService');

function challanOutput(transfer, showPricesOnChallan) {
  let totalPieces = 0;
  const lines = transfer.lines.map((line) => {
    const quantity = Number(line.dispatchedQuantity || 0);
    const unitsPerPackage = Number(line.unitsPerPackage);
    const isPackaged = Number.isInteger(unitsPerPackage) && unitsPerPackage > 1;
    const pieces = isPackaged ? Math.round(quantity * unitsPerPackage) : Math.round(quantity);
    const boxQuantity = isPackaged ? Math.floor(pieces / unitsPerPackage) : 0;
    const pieceQuantity = isPackaged ? pieces % unitsPerPackage : pieces;
    if (!line.isWeightBased) totalPieces += pieces;
    return {
      productId: line.productId,
      productName: line.productName,
      barcode: line.barcode,
      unit: line.unit || 'Pcs',
      isWeightBased: line.isWeightBased,
      quantity,
      boxQuantity,
      pieceQuantity,
      ...(showPricesOnChallan ? { price: line.price } : {}),
    };
  });
  return {
    ...transfer,
    challanNumber: transfer.transferNumber,
    date: transfer.dispatchedAt,
    totalLines: lines.length,
    totalPieces,
    showPricesOnChallan,
    lines,
  };
}

async function getTransferChallan(req, res, next) {
  try {
    const transfer = await loadScopedTransfer(req.params.id, req);
    if (!canPrintChallan(transfer)) throw statusError('A challan is available after dispatch', 409);
    const settings = await Settings.findOne({ singleton: 'global' }).lean();
    const showPricesOnChallan = Boolean(settings?.showPricesOnChallan);
    const [output] = await transferOutputs([transfer], { includePrices: showPricesOnChallan });
    return res.json({
      success: true,
      challan: challanOutput(output, showPricesOnChallan),
    });
  } catch (error) {
    return next(error);
  }
}

async function printTransferChallan(req, res, next) {
  let session;
  try {
    session = await mongoose.startSession();
    let transfer;
    let isReprint;
    await session.withTransaction(async () => {
      transfer = await loadScopedTransfer(req.params.id, req, session, {
        allowAllLocationAccess: true,
      });
      if (!canPrintChallan(transfer)) throw statusError('A challan is available after dispatch', 409);
      const before = transfer.toObject();
      isReprint = Number(transfer.challanPrintCount || 0) > 0;
      transfer.challanPrintCount = Number(transfer.challanPrintCount || 0) + 1;
      await transfer.save({ session });
      await AuditLog.create([{
        actorId: req.user._id,
        action: 'PRINT',
        entity: 'StockTransfer',
        entityId: transfer._id,
        before,
        after: transfer.toObject(),
        metadata: { challanNumber: transferNumber(transfer._id), reprint: isReprint },
        ipAddress: req.ip,
      }], { session });
    });
    const settings = await Settings.findOne({ singleton: 'global' }).lean();
    const showPricesOnChallan = Boolean(settings?.showPricesOnChallan);
    const [output] = await transferOutputs([transfer], { includePrices: showPricesOnChallan });
    return res.json({
      success: true,
      isReprint,
      challan: challanOutput(output, showPricesOnChallan),
    });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
}

module.exports = { getTransferChallan, printTransferChallan };
