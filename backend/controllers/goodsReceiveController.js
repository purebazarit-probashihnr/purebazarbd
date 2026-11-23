const mongoose = require('mongoose');
const {
  AuditLog, GoodsReceive, Location, Product, StockMovement, Vendor,
} = require('../models');
const { unitLabelMap, displayFields } = require('../utils/productDisplay');
const { createVendorCopy } = require('../services/vendorProductCopy');

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeLines(lines) {
  const combined = new Map();
  for (const line of lines) {
    const current = combined.get(line.productId) || {
      productId: line.productId, receivedQuantity: 0, acceptedQuantity: 0, rejectedQuantity: 0,
    };
    current.receivedQuantity += line.receivedQuantity;
    current.acceptedQuantity += line.acceptedQuantity;
    current.rejectedQuantity += line.rejectedQuantity;
    combined.set(line.productId, current);
  }
  return [...combined.values()];
}

async function validateProducts(ownerType, vendorId, lines) {
  if (ownerType === 'VENDOR') {
    if (!vendorId) throw statusError('Vendor purchases require a vendor', 400);
    const vendor = await Vendor.findById(vendorId).lean();
    if (!vendor) throw statusError('Vendor not found', 400);
    if (vendor.status !== 'Active') throw statusError('Only active vendors can receive new goods', 409);
  } else if (vendorId) {
    throw statusError('Company purchases cannot have a vendor', 400);
  }

  const productIds = lines.map(({ productId }) => productId);
  const products = await Product.find({ _id: { $in: productIds } })
    .select('_id name barcode ownerType vendorId').lean();
  if (products.length !== productIds.length) throw statusError('One or more products were not found', 400);
  const validProducts = products.every((product) => (
    product.ownerType === ownerType
    && (ownerType === 'COMPANY' || product.vendorId?.toString() === vendorId.toString())
  ));
  if (!validProducts) throw statusError('Products must match the purchase owner and vendor', 400);
}

async function validateReceiveLocation(warehouseId) {
  const location = await Location.findById(warehouseId).select('_id type isActive').lean();
  if (!location || location.isActive === false || !['CENTRAL', 'OUTLET'].includes(location.type)) {
    throw statusError('Goods receives must be recorded at a valid active location', 400);
  }
  return location;
}

async function validateSelectedLocation(req) {
  if (req.locationId) await validateReceiveLocation(req.locationId);
}

function assertReceiveInScope(receive, req) {
  if (req.locationId && receive.warehouseId.toString() !== req.locationId.toString()) {
    throw statusError('Goods receive not found', 404);
  }
}

function receiveOutput(receive, products = [], labels = new Map()) {
  const productMap = new Map(products.map((product) => [product._id.toString(), product]));
  const data = receive.toObject ? receive.toObject() : receive;
  return {
    id: data._id.toString(),
    ownerType: data.ownerType,
    vendorId: data.vendorId?.toString() || null,
    warehouseId: data.warehouseId.toString(),
    vendorChallanNumber: data.vendorChallanNumber || null,
    status: data.status,
    createdBy: data.createdBy?.toString(),
    approvedBy: data.approvedBy?.toString() || null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    lines: data.lines.map((line) => {
      const product = productMap.get(line.productId.toString());
      return {
        productId: line.productId.toString(),
        productName: product?.name,
        ...(product ? { displayName: displayFields(product, labels).displayName } : {}),
        barcode: product?.barcode,
        receivedQuantity: line.receivedQuantity,
        acceptedQuantity: line.acceptedQuantity,
        rejectedQuantity: line.rejectedQuantity,
      };
    }),
  };
}

async function searchProducts(req, res, next) {
  try {
    const {
      ownerType, vendorId, q, warehouseId, mode,
    } = req.query;
    if (ownerType === 'VENDOR') {
      const vendor = await Vendor.findById(vendorId).lean();
      if (!vendor) throw statusError('Vendor not found', 404);
      if (vendor.status !== 'Active') throw statusError('Only active vendors can receive new goods', 409);
    }
    const filter = {};
    if (ownerType) filter.ownerType = ownerType;
    if (ownerType === 'VENDOR') filter.vendorId = vendorId;
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: new RegExp(escaped, 'i') },
        { barcode: new RegExp(escaped, 'i') },
        { barcodes: new RegExp(escaped, 'i') },
      ];
    }
    let stockByProduct = new Map();
    if (warehouseId) {
      const grouped = await StockMovement.aggregate([
        { $match: { warehouseId: new mongoose.Types.ObjectId(warehouseId) } },
        { $group: { _id: '$productId', quantity: { $sum: '$quantity' } } },
      ]);
      stockByProduct = new Map(grouped.map(({ _id, quantity }) => [_id.toString(), quantity]));
      if (mode === 'REMOVE') {
        filter._id = { $in: grouped.filter(({ quantity }) => quantity > 0).map(({ _id }) => _id) };
      }
    }
    let productQuery = Product.find(filter).select('_id name unitId unitsPerPackage barcode barcodes barcodeSource ownerType vendorId vendorPrice mrp productGroupId')
      .sort({ name: 1 });
    if (warehouseId) productQuery = productQuery.limit(Math.min(Number(req.query.limit) || 10, 10));
    const products = await productQuery.lean();
    const labels = await unitLabelMap(products);
    const vendorIds = [...new Set(products.map((product) => product.vendorId?.toString()).filter(Boolean))];
    const vendorRows = vendorIds.length
      ? await Vendor.find({ _id: { $in: vendorIds } }).select('_id name shopName').lean()
      : [];
    const vendors = new Map(vendorRows.map((vendor) => [vendor._id.toString(), vendor.shopName || vendor.name]));
    let otherVendorMatches = [];
    if (ownerType === 'VENDOR' && q && products.length === 0) {
      const exact = await Product.find({
        ownerType: 'VENDOR',
        vendorId: { $ne: vendorId },
        $or: [{ barcode: q.trim() }, { barcodes: q.trim() }],
      }).select('_id name unitId unitsPerPackage barcode barcodes barcodeSource ownerType vendorId vendorPrice mrp productGroupId')
        .sort({ name: 1 }).limit(10).lean();
      const otherVendorIds = [...new Set(exact.map((product) => product.vendorId?.toString()).filter(Boolean))];
      const otherVendors = otherVendorIds.length
        ? await Vendor.find({ _id: { $in: otherVendorIds } }).select('_id name shopName').lean()
        : [];
      const otherVendorNames = new Map(otherVendors.map((vendor) => [vendor._id.toString(), vendor.shopName || vendor.name]));
      otherVendorMatches = exact.map((product) => ({
        id: product._id.toString(),
        name: product.name,
        barcode: product.barcode,
        barcodes: product.barcodes || [],
        vendorId: product.vendorId?.toString() || null,
        vendorName: otherVendorNames.get(product.vendorId?.toString()) || 'Other vendor',
        vendorPrice: product.vendorPrice,
        mrp: product.mrp,
      }));
    }
    return res.json({
      success: true,
      products: products.map((product) => ({
        id: product._id.toString(),
        name: product.name,
        ...displayFields(product, labels),
        unitsPerPackage: product.unitsPerPackage || 1,
        isWeightBased: /^(gram|grams|g)$/i.test(String(labels.names.get(product.unitId?.toString()) || '').trim()),
        barcode: product.barcode,
        barcodes: product.barcodes || [],
        ownerType: product.ownerType,
        vendorId: product.vendorId?.toString() || null,
        vendorName: vendors.get(product.vendorId?.toString()) || null,
        productGroupId: product.productGroupId?.toString() || null,
        ...(warehouseId ? { stockQuantity: stockByProduct.get(product._id.toString()) || 0 } : {}),
      })),
      otherVendorMatches,
    });
  } catch (error) {
    return next(error);
  }
}

async function createReceiveVendorCopy(req, res, next) {
  try {
    const { copy, vendor } = await createVendorCopy({
      sourceProductId: req.body.sourceProductId,
      vendorId: req.body.vendorId,
      vendorPrice: req.body.vendorPrice,
      mrp: req.body.mrp,
      actorId: req.user._id,
      ipAddress: req.ip,
    });
    const labels = await unitLabelMap([copy]);
    return res.status(201).json({
      success: true,
      product: {
        id: copy._id.toString(),
        name: copy.name,
        ...displayFields(copy, labels),
        barcode: copy.barcode,
        barcodes: copy.barcodes || [],
        ownerType: copy.ownerType,
        vendorId: vendor._id.toString(),
        vendorName: vendor.shopName || vendor.name,
        unitsPerPackage: copy.unitsPerPackage || 1,
        isWeightBased: /^(gram|grams|g)$/i.test(String(labels.names.get(copy.unitId?.toString()) || '').trim()),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function nextChallanNumber(req, res, next) {
  try {
    const vendor = await Vendor.findById(req.params.id).select('_id memberId vendorCode').lean();
    if (!vendor) throw statusError('Vendor not found', 404);
    const code = String(vendor.memberId || vendor.vendorCode || vendor._id.toString().slice(-6)).toUpperCase();
    let sequence = await GoodsReceive.countDocuments({ vendorId: vendor._id }) + 1;
    let challan = `CHN-${code}-${String(sequence).padStart(4, '0')}`;
    while (await GoodsReceive.exists({ vendorId: vendor._id, vendorChallanNumber: challan })) {
      sequence += 1;
      challan = `CHN-${code}-${String(sequence).padStart(4, '0')}`;
    }
    return res.json({ success: true, challanNumber: challan });
  } catch (error) {
    return next(error);
  }
}

async function listVendors(req, res, next) {
  try {
    const vendors = await Vendor.find({ status: 'Active' })
      .select('_id name shopName memberId vendorCode membershipType mobile status')
      .sort({ name: 1 })
      .lean();
    return res.json({
      success: true,
      vendors: vendors.map((vendor) => ({
        id: vendor._id.toString(),
        name: vendor.name,
        shopName: vendor.shopName,
        memberId: (vendor.membershipType || 'Probashi member') === 'Non-member' ? null : vendor.memberId,
        vendorCode: vendor.vendorCode
          || ((vendor.membershipType || 'Probashi member') === 'Non-member' ? vendor.memberId : null),
        membershipType: vendor.membershipType || 'Probashi member',
        mobile: vendor.mobile,
        status: vendor.status,
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function listGoodsReceives(req, res, next) {
  try {
    await validateSelectedLocation(req);
    const filter = req.locationId ? { warehouseId: req.locationId } : {};
    const receives = await GoodsReceive.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ success: true, goodsReceives: receives.map((receive) => receiveOutput(receive)) });
  } catch (error) {
    return next(error);
  }
}

async function createGoodsReceive(req, res, next) {
  try {
    const lines = normalizeLines(req.body.lines);
    await validateReceiveLocation(req.body.warehouseId);
    await validateProducts(req.body.ownerType, req.body.vendorId, lines);
    if (req.body.ownerType === 'VENDOR' && !req.body.vendorChallanNumber) {
      throw statusError('Vendor purchases require a challan number', 400);
    }
    const [receive] = await GoodsReceive.create([{
      ownerType: req.body.ownerType,
      ...(req.body.vendorId ? { vendorId: req.body.vendorId } : {}),
      warehouseId: req.body.warehouseId,
      ...(req.body.vendorChallanNumber ? { vendorChallanNumber: req.body.vendorChallanNumber } : {}),
      lines,
      createdBy: req.user._id,
    }]);
    await AuditLog.create({
      actorId: req.user._id, action: 'CREATE', entity: 'GoodsReceive', entityId: receive._id,
      after: receive.toObject(), ipAddress: req.ip,
    });
    return res.status(201).json({ success: true, goodsReceive: receiveOutput(receive) });
  } catch (error) {
    return next(error);
  }
}

async function updateGoodsReceive(req, res, next) {
  try {
    const receive = await GoodsReceive.findById(req.params.id);
    if (!receive) throw statusError('Goods receive not found', 404);
    assertReceiveInScope(receive, req);
    if (receive.status !== 'Draft') throw statusError('Only draft goods receives can be edited', 409);

    const before = receive.toObject();
    const ownerType = req.body.ownerType || receive.ownerType;
    const vendorId = Object.prototype.hasOwnProperty.call(req.body, 'vendorId') ? req.body.vendorId : receive.vendorId;
    const lines = req.body.lines ? normalizeLines(req.body.lines) : receive.lines;
    await validateReceiveLocation(req.body.warehouseId || receive.warehouseId);
    await validateProducts(ownerType, vendorId, lines);
    const challan = Object.prototype.hasOwnProperty.call(req.body, 'vendorChallanNumber')
      ? req.body.vendorChallanNumber : receive.vendorChallanNumber;
    if (ownerType === 'VENDOR' && !challan) throw statusError('Vendor purchases require a challan number', 400);

    receive.ownerType = ownerType;
    receive.vendorId = vendorId || undefined;
    receive.warehouseId = req.body.warehouseId || receive.warehouseId;
    receive.vendorChallanNumber = challan || undefined;
    receive.lines = lines;
    await receive.save();
    await AuditLog.create({
      actorId: req.user._id, action: 'UPDATE', entity: 'GoodsReceive', entityId: receive._id,
      before, after: receive.toObject(), ipAddress: req.ip,
    });
    return res.json({ success: true, goodsReceive: receiveOutput(receive) });
  } catch (error) {
    return next(error);
  }
}

async function getGoodsReceive(req, res, next) {
  try {
    const receive = await GoodsReceive.findById(req.params.id).lean();
    if (!receive) throw statusError('Goods receive not found', 404);
    assertReceiveInScope(receive, req);
    const ids = receive.lines.map((line) => line.productId);
    const [products, vendor, location] = await Promise.all([
      Product.find({ _id: { $in: ids } }).select('_id name barcode unitId').lean(),
      receive.vendorId
        ? Vendor.findById(receive.vendorId).select('_id name shopName memberId vendorCode membershipType').lean()
        : null,
      Location.findById(receive.warehouseId).select('name').lean(),
    ]);
    const labels = await unitLabelMap(products);
    return res.json({
      success: true,
      goodsReceive: {
        ...receiveOutput(receive, products, labels),
        locationName: location?.name || null,
        vendor: vendor ? {
          id: vendor._id.toString(),
          name: vendor.name,
          shopName: vendor.shopName,
          memberId: (vendor.membershipType || 'Probashi member') === 'Non-member' ? null : vendor.memberId,
          vendorCode: vendor.vendorCode
            || ((vendor.membershipType || 'Probashi member') === 'Non-member' ? vendor.memberId : null),
          membershipType: vendor.membershipType || 'Probashi member',
        } : null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function approveGoodsReceive(req, res, next) {
  let session;
  try {
    session = await mongoose.startSession();
    let output;
    await session.withTransaction(async () => {
      const receive = await GoodsReceive.findById(req.params.id).session(session);
      if (!receive) throw statusError('Goods receive not found', 404);
      assertReceiveInScope(receive, req);
      if (receive.status !== 'Draft') throw statusError('Only draft goods receives can be approved', 409);
      if (receive.ownerType === 'VENDOR') {
        const vendor = await Vendor.findById(receive.vendorId).lean();
        if (!vendor) throw statusError('Vendor not found', 404);
        if (vendor.status !== 'Active') {
          throw statusError('Only active vendors can receive new goods', 409);
        }
      }

      const before = receive.toObject();
      receive.status = 'Approved';
      receive.approvedBy = req.user._id;
      await receive.save({ session });
      const movements = receive.lines
        .filter((line) => line.acceptedQuantity > 0)
        .map((line) => ({
          productId: line.productId,
          warehouseId: receive.warehouseId,
          quantity: line.acceptedQuantity,
          type: 'GRN',
          userId: req.user._id,
          reason: `Goods receive ${receive._id}`,
          referenceId: receive._id,
          referenceType: 'GoodsReceive',
        }));
      if (movements.length) await StockMovement.create(movements, { session, ordered: true });
      await AuditLog.create([{
        actorId: req.user._id, action: 'APPROVE', entity: 'GoodsReceive', entityId: receive._id,
        before, after: receive.toObject(), ipAddress: req.ip,
      }], { session });
      output = receiveOutput(receive);
    });
    return res.json({ success: true, goodsReceive: output });
  } catch (error) {
    return next(error);
  } finally {
    if (session) await session.endSession();
  }
}

async function rejectGoodsReceive(req, res, next) {
  try {
    const receive = await GoodsReceive.findById(req.params.id);
    if (!receive) throw statusError('Goods receive not found', 404);
    assertReceiveInScope(receive, req);
    if (receive.status !== 'Draft') throw statusError('Only draft goods receives can be rejected', 409);
    const before = receive.toObject();
    receive.status = 'Rejected';
    await receive.save();
    await AuditLog.create({
      actorId: req.user._id, action: 'REJECT', entity: 'GoodsReceive', entityId: receive._id,
      before, after: receive.toObject(), ipAddress: req.ip,
    });
    return res.json({ success: true, goodsReceive: receiveOutput(receive) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  searchProducts, nextChallanNumber, listVendors, listGoodsReceives, createGoodsReceive, updateGoodsReceive,
  getGoodsReceive, approveGoodsReceive, rejectGoodsReceive,
  createReceiveVendorCopy,
};
