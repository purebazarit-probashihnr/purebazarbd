const { isGram, productLabel } = require('./stock-units.cjs');

function addReceiveProductLine(lines, product) {
  if (lines.some((line) => line.productId === product.id)) return lines;
  return [...lines, {
    productId: product.id,
    productName: productLabel(product),
    barcode: product.barcode,
    vendorName: product.vendorName || null,
    isWeightBased: Boolean(product.isWeightBased) || isGram(product.packageUnitName),
    receivedQuantity: 1,
    acceptedQuantity: 1,
    rejectedQuantity: 0,
  }];
}

module.exports = { addReceiveProductLine };
