const {
  AuditLog, PriceHistory, Product, Vendor,
} = require('../models');
const {
  barcodeFilter, findInternalBarcodeConflict, isInternalBarcodeProduct, normalizeBarcodes,
} = require('../utils/productBarcodes');

function statusError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function snapshot(product) {
  return {
    name: product.name,
    categoryId: product.categoryId,
    brandId: product.brandId,
    unitId: product.unitId,
    ownerType: product.ownerType,
    vendorId: product.vendorId,
    productGroupId: product.productGroupId,
    vendorPrice: product.vendorPrice,
    mrp: product.mrp,
    vatApplicable: product.vatApplicable,
    vatRate: product.vatRate,
    barcode: product.barcode,
    barcodes: product.barcodes || [],
    barcodeSource: product.barcodeSource,
  };
}

async function createVendorCopy({
  sourceProduct, sourceProductId, vendorId, vendorPrice, mrp, actorId, ipAddress,
}) {
  const source = sourceProduct || await Product.findById(sourceProductId);
  if (!source) throw statusError('Product not found', 404);
  const vendor = await Vendor.findById(vendorId).lean();
  if (!vendor) throw statusError('Vendor not found', 400);
  if (vendor.status && vendor.status !== 'Active') {
    throw statusError('Only active vendors can receive new product copies', 409);
  }
  if (source.ownerType === 'VENDOR' && source.vendorId?.toString() === vendor._id.toString()) {
    throw statusError('This product already belongs to the selected vendor', 409);
  }
  const barcodeKeys = normalizeBarcodes(source.barcode, source.barcodes);
  if (await Product.exists({
    ownerType: 'VENDOR',
    vendorId: vendor._id,
    ...barcodeFilter(barcodeKeys),
  })) {
    throw statusError('This vendor already has a product with one of these barcodes', 409);
  }
  const productGroupId = source.productGroupId || source._id;
  const internalConflict = await findInternalBarcodeConflict(Product, barcodeKeys, {
    productGroupId: productGroupId.toString(),
  });
  if (internalConflict) {
    throw statusError(`This code is already the in-store code of ${internalConflict.name}`, 409);
  }
  const barcodeSource = source.barcodeSource
    || (isInternalBarcodeProduct(source) ? 'internal' : 'manufacturer');
  if (!source.productGroupId) {
    source.productGroupId = productGroupId;
    await source.save();
  }
  let copy;
  try {
    copy = await Product.create({
      name: source.name,
      ...(source.sku ? { sku: source.sku } : {}),
      categoryId: source.categoryId,
      ...(source.brandId ? { brandId: source.brandId } : {}),
      unitId: source.unitId,
      ...(source.unitValue !== undefined ? { unitValue: source.unitValue } : {}),
      ownerType: 'VENDOR',
      vendorId: vendor._id,
      productGroupId,
      vendorPrice,
      mrp,
      ...(source.unitsPerPackage ? { unitsPerPackage: source.unitsPerPackage } : {}),
      ...(source.subUnitPriceOverride !== undefined ? { subUnitPriceOverride: source.subUnitPriceOverride } : {}),
      vatApplicable: source.vatApplicable,
      ...(source.vatRate !== undefined ? { vatRate: source.vatRate } : {}),
      barcode: source.barcode,
      barcodes: source.barcodes || [],
      barcodeSource,
      listedOnline: source.listedOnline,
    });
  } catch (error) {
    if (error.code === 11000) error.status = 409;
    throw error;
  }
  await PriceHistory.create({
    productId: copy._id,
    oldVendorPrice: source.vendorPrice,
    newVendorPrice: copy.vendorPrice,
    oldMrp: source.mrp,
    newMrp: copy.mrp,
    changedBy: actorId,
    reason: `Created vendor copy from product ${source._id}`,
  });
  await AuditLog.create({
    actorId,
    action: 'CREATE',
    entity: 'Product',
    entityId: copy._id,
    before: snapshot(source),
    after: snapshot(copy),
    metadata: { copiedFrom: source._id.toString() },
    ipAddress,
  });
  return { copy, vendor };
}

module.exports = { createVendorCopy };
