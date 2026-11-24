const mongoose = require('mongoose');
const {
  Location, Product, StockMovement, Vendor,
} = require('../models');
const { unitLabelMap, displayFields } = require('../utils/productDisplay');
const { isSuperAdmin } = require('../utils/locationScope');

async function stockForLocation(location) {
  const warehouseId = location._id;
  const grouped = await StockMovement.aggregate([
    { $match: { warehouseId: new mongoose.Types.ObjectId(warehouseId) } },
    { $group: { _id: '$productId', quantity: { $sum: '$quantity' } } },
    { $sort: { _id: 1 } },
  ]);
  const products = await Product.find({ _id: { $in: grouped.map(({ _id }) => _id) } })
    .select('_id name barcode barcodes ownerType vendorId unitId unitsPerPackage').lean();
  const labels = await unitLabelMap(products);
  const vendorIds = [...new Set(products.map((product) => product.vendorId?.toString()).filter(Boolean))];
  const vendors = vendorIds.length
    ? await Vendor.find({ _id: { $in: vendorIds } }).select('_id name shopName').lean()
    : [];
  const vendorsById = new Map(vendors.map((vendor) => [vendor._id.toString(), vendor]));
  const productMap = new Map(products.map((product) => [product._id.toString(), product]));
  const stock = grouped.map(({ _id, quantity }) => {
    const product = productMap.get(_id.toString());
    const vendor = vendorsById.get(product?.vendorId?.toString());
    return {
      productId: _id.toString(),
      productName: product?.name,
      barcode: product?.barcode,
      barcodes: product?.barcodes || [],
      ownerType: product?.ownerType,
      vendorId: product?.vendorId?.toString() || null,
      vendorName: product?.ownerType === 'COMPANY' ? 'Company' : vendor?.name || null,
      vendorBrand: product?.ownerType === 'COMPANY' ? '-' : vendor?.shopName || '-',
      unitsPerPackage: product?.unitsPerPackage || 1,
      packageUnitName: product ? displayFields(product, labels).packageUnitName : null,
      quantity: Math.round(quantity * 1e6) / 1e6,
    };
  });
  return stock;
}

async function getWarehouseStock(req, res, next) {
  try {
    const warehouseId = req.locationId || req.query.warehouseId;
    if (!warehouseId) {
      const error = new Error('Select a location to view stock');
      error.status = 400;
      throw error;
    }
    const location = await Location.findById(warehouseId).select('_id type isActive').lean();
    if (!location || location.isActive === false || !['CENTRAL', 'OUTLET'].includes(location.type)) {
      const error = new Error('Stock is available only for an active location');
      error.status = 400;
      throw error;
    }
    const stock = await stockForLocation(location);
    return res.json({ success: true, warehouseId: warehouseId.toString(), stock });
  } catch (error) {
    return next(error);
  }
}

async function getCentralWarehouseStock(req, res, next) {
  try {
    const warehouse = await Location.findOne({ type: 'CENTRAL', isActive: { $ne: false } })
      .select('_id name type isActive').lean();
    if (!warehouse) {
      const error = new Error('Central Warehouse was not found or is inactive.');
      error.status = 404;
      throw error;
    }
    if (req.locationId && req.locationId.toString() !== warehouse._id.toString()) {
      const error = new Error('Central Warehouse stock is not available for your assigned location.');
      error.status = 403;
      throw error;
    }
    const stock = await stockForLocation(warehouse);
    return res.json({
      success: true,
      warehouseId: warehouse._id.toString(),
      warehouse: { id: warehouse._id.toString(), name: warehouse.name },
      stock,
    });
  } catch (error) {
    return next(error);
  }
}

async function getOutletProducts(req, res, next) {
  try {
    const allLocations = req.query.allLocations === 'true';
    if (allLocations && !isSuperAdmin(req.user) && !req.user.canViewAllLocations) {
      const error = new Error('You are not allowed to view inventory across all locations.');
      error.status = 403;
      throw error;
    }
    const warehouseId = req.locationId || req.query.warehouseId;
    if (!warehouseId && !allLocations) {
      const error = new Error('Select a location to view outlet inventory');
      error.status = 400;
      throw error;
    }
    const locations = allLocations
      ? await Location.find({ type: { $in: ['CENTRAL', 'OUTLET'] }, isActive: { $ne: false } })
        .select('_id name type isActive').sort({ type: 1, name: 1 }).lean()
      : [await Location.findById(warehouseId).select('_id name type isActive').lean()];
    if (!locations.length || locations.some((location) => (
      !location || location.isActive === false || !['CENTRAL', 'OUTLET'].includes(location.type)
    ))) {
      const error = new Error('Inventory is available only for active locations');
      error.status = 400;
      throw error;
    }
    const locationIds = locations.map(({ _id }) => new mongoose.Types.ObjectId(_id));
    const [products, grouped] = await Promise.all([
      Product.find().select('_id name sku barcode barcodes ownerType vendorId unitsPerPackage unitId').sort({ name: 1 }).lean(),
      StockMovement.aggregate([
        { $match: { warehouseId: { $in: locationIds } } },
        {
          $group: {
            _id: { productId: '$productId', warehouseId: '$warehouseId' },
            quantity: { $sum: '$quantity' },
          },
        },
      ]),
    ]);
    const stockByProductLocation = new Map(grouped.map(({ _id, quantity }) => [
      `${_id.warehouseId.toString()}|${_id.productId.toString()}`,
      quantity,
    ]));
    const labels = await unitLabelMap(products);
    const vendorIds = [...new Set(products.map((product) => product.vendorId?.toString()).filter(Boolean))];
    const vendors = vendorIds.length
      ? await Vendor.find({ _id: { $in: vendorIds } }).select('_id name shopName').lean()
      : [];
    const vendorsById = new Map(vendors.map((vendor) => [vendor._id.toString(), vendor]));
    const inventory = locations.flatMap((location) => products.map((product) => {
      const vendor = vendorsById.get(product.vendorId?.toString());
      return {
        productId: product._id.toString(),
        name: product.name,
        sku: product.sku || '',
        barcode: product.barcode || '',
        barcodes: product.barcodes || [],
        ownerType: product.ownerType,
        vendorId: product.vendorId?.toString() || null,
        vendorName: product.ownerType === 'COMPANY' ? 'Company' : vendor?.name || null,
        vendorBrand: product.ownerType === 'COMPANY' ? '-' : vendor?.shopName || '-',
        locationId: location._id.toString(),
        locationName: location.name,
        unitsPerPackage: product.unitsPerPackage || 1,
        packageUnitName: displayFields(product, labels).packageUnitName,
        stock: Math.round((
          stockByProductLocation.get(`${location._id.toString()}|${product._id.toString()}`) || 0
        ) * 1e6) / 1e6,
      };
    }));
    return res.json({
      success: true,
      ...(allLocations ? { allLocations: true } : {
        warehouseId: locations[0]._id.toString(),
      }),
      products: inventory,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getWarehouseStock, getCentralWarehouseStock, getOutletProducts };
