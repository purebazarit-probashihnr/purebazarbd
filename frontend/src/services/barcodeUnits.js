const { canSellPieces, unitOptions, unitPrice } = require('./pos-cart-utils.cjs');

// Selectable units for a label, priced with the same rules as POS billing:
// package = mrp, base unit = subUnitPrice.
function getUnitOptions(product) {
  const baseName = product?.packageUnitName || product?.unitLabel || 'Unit';
  if (!canSellPieces(product || {})) return [{ value: 'base', name: baseName, price: unitPrice(product || {}) }];
  return unitOptions(product).map((option) => ({
    value: option.key === 'PACKAGE' ? 'base' : option.key,
    name: option.key === 'PIECE' ? 'Pcs' : option.label,
    price: option.price,
  }));
}

module.exports = { getUnitOptions };
