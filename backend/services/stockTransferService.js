const {
  Location, Product, StockTransfer, User,
} = require('../models');
const { unitLabelMap } = require('../utils/productDisplay');
const { isSuperAdmin } = require('../utils/locationScope');

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function locationFilter(req) {
  if (isSuperAdmin(req.user) || req.user.canViewAllLocations) {
    if (!req.locationId) return {};
    return {
      $or: [
        { fromWarehouseId: req.locationId },
        { toWarehouseId: req.locationId },
      ],
    };
  }
  return {
    $or: [
      { fromWarehouseId: req.locationId },
      { toWarehouseId: req.locationId },
    ],
  };
}

function transferNumber(id) {
  return id.toString().slice(-8).toUpperCase();
}

function transferOutput(transfer, productsById, userNames, locationNames, includePrices = false) {
  const data = transfer.toObject ? transfer.toObject() : transfer;
  const receivedBy = data.receivedBy?.toString() || null;
  const dispatchedBy = data.dispatchedBy?.toString() || null;
  const fromWarehouseId = data.fromWarehouseId.toString();
  const toWarehouseId = data.toWarehouseId.toString();
  return {
    id: data._id.toString(),
    transferNumber: transferNumber(data._id),
    fromWarehouseId,
    fromLocationName: locationNames.get(fromWarehouseId) || null,
    toWarehouseId,
    toLocationName: locationNames.get(toWarehouseId) || null,
    status: data.status,
    createdBy: data.createdBy?.toString(),
    dispatchedBy,
    dispatchedByName: dispatchedBy ? userNames.get(dispatchedBy) || null : null,
    receivedBy,
    receivedByName: receivedBy ? userNames.get(receivedBy) || null : null,
    dispatchedAt: data.dispatchedAt || null,
    receivedAt: data.receivedAt || null,
    carrierName: data.carrierName || '',
    carrierPhone: data.carrierPhone || '',
    vehicle: data.vehicle || '',
    notes: data.notes || '',
    challanPrintCount: data.challanPrintCount || 0,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    lines: data.lines.map((line) => {
      const productId = line.productId.toString();
      const product = productsById.get(productId);
      return {
        productId,
        productName: product?.name || null,
        barcode: product?.barcode || null,
        isWeightBased: Boolean(product?.isWeightBased),
        unit: product?.unitName || null,
        unitsPerPackage: product?.unitsPerPackage || 1,
        ...(includePrices ? { price: product?.mrp ?? null } : {}),
        requestedQuantity: line.requestedQuantity,
        dispatchedQuantity: line.dispatchedQuantity ?? null,
        receivedQuantity: line.receivedQuantity ?? null,
        discrepancyQuantity: line.discrepancyQuantity ?? null,
      };
    }),
  };
}

async function transferOutputs(transfers, { includePrices = false } = {}) {
  const items = Array.isArray(transfers) ? transfers : [transfers];
  const transferData = items.map((transfer) => (transfer.toObject ? transfer.toObject() : transfer));
  const productIds = [...new Set(transferData.flatMap((data) => (
    data.lines.map((line) => line.productId.toString())
  )))];
  const products = await Product.find({ _id: { $in: productIds } })
    .select('_id name barcode unitId unitsPerPackage mrp').lean();
  const labels = await unitLabelMap(products);
  const productsById = new Map(products.map((product) => [product._id.toString(), {
    ...product,
    unitName: labels.names.get(product.unitId?.toString()) || null,
    isWeightBased: /^(gram|grams|g)$/i.test(String(labels.names.get(product.unitId?.toString()) || '').trim()),
  }]));
  const userIds = [...new Set(transferData.flatMap((data) => [
    data.dispatchedBy?.toString(),
    data.receivedBy?.toString(),
  ]).filter(Boolean))];
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds } }).select('_id name').lean()
    : [];
  const userNames = new Map(users.map((user) => [user._id.toString(), user.name]));
  const locationIds = [...new Set(transferData.flatMap((data) => [
    data.fromWarehouseId.toString(),
    data.toWarehouseId.toString(),
  ]))];
  const locations = await Location.find({ _id: { $in: locationIds } }).select('_id name').lean();
  const locationNames = new Map(locations.map((location) => [location._id.toString(), location.name]));
  return items.map((transfer) => transferOutput(
    transfer, productsById, userNames, locationNames, includePrices,
  ));
}

function canPrintChallan(transfer) {
  return transfer.status !== 'Requested';
}

async function loadScopedTransfer(id, req, session, {
  allowAllLocationReceipt = false,
  allowAllLocationAccess = false,
} = {}) {
  const canLoadAnyForReceipt = allowAllLocationReceipt
    && req.user.canViewAllLocations
    && req.user.permissions.includes('stock:transfer:receive');
  const canLoadAnyForChallan = allowAllLocationAccess
    && req.user.canViewAllLocations
    && req.user.permissions.includes('stock:transfer:read');
  let query = StockTransfer.findOne({
    _id: id,
    ...(canLoadAnyForReceipt || canLoadAnyForChallan ? {} : locationFilter(req)),
  });
  if (session) query = query.session(session);
  const transfer = await query;
  if (!transfer) throw statusError('Stock transfer not found', 404);
  return transfer;
}

module.exports = {
  canPrintChallan,
  loadScopedTransfer,
  locationFilter,
  statusError,
  transferNumber,
  transferOutputs,
};
