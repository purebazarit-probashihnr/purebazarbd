const mongoose = require('mongoose');
const { Product, StockMovement } = require('../models');
const { unitLabelMap, displayFields, stockLabelFor } = require('../utils/productDisplay');

async function getWarehouseStock(req, res, next) {
  try {
    const grouped = await StockMovement.aggregate([
      { $match: { warehouseId: new mongoose.Types.ObjectId(req.query.warehouseId) } },
      { $group: { _id: '$productId', quantity: { $sum: '$quantity' } } },
      { $sort: { _id: 1 } },
    ]);
    const products = await Product.find({ _id: { $in: grouped.map(({ _id }) => _id) } })
      .select('_id name barcode ownerType vendorId unitId baseUnitId unitsPerPackage sellingUnits').lean();
    const labels = await unitLabelMap(products);
    const productMap = new Map(products.map((product) => [product._id.toString(), product]));
    const stock = grouped.map(({ _id, quantity }) => {
      const product = productMap.get(_id.toString());
      const fields = product ? displayFields(product, labels) : {};
      return {
        productId: _id.toString(),
        productName: product?.name,
        barcode: product?.barcode,
        ownerType: product?.ownerType,
        vendorId: product?.vendorId?.toString() || null,
        unitsPerPackage: product?.unitsPerPackage || 1,
        packageUnitName: fields.packageUnitName || null,
        baseKind: fields.baseKind || 'COUNT',
        baseUnitName: fields.baseUnitName || 'pcs',
        sellingUnits: fields.sellingUnits || [],
        quantity: Math.round(quantity),
        quantityLabel: product ? stockLabelFor(product, fields, quantity) : String(Math.round(quantity)),
      };
    });
    return res.json({ success: true, warehouseId: req.query.warehouseId, stock });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getWarehouseStock };
