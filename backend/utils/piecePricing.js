// Prices are handled in integer cents so ceiling never suffers float drift.
function toCents(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100);
}

function roundUpToCent(value) {
  const cents = Number(value) * 100;
  // Subtract a tiny tolerance so exact results such as 12.5 * 100 do not round up.
  return Math.ceil(cents - 1e-9) / 100;
}

// unitsPerPackage is the conversion: base units (pcs, kg) per package (box, sack). Prices are saved per package.
function conversionOf(product) {
  const units = Number(product && product.unitsPerPackage);
  return Number.isFinite(units) && units >= 1 ? units : 1;
}

function calculateSubUnitPrice(packagePrice, unitsPerPackage) {
  const units = Number(unitsPerPackage);
  if (!Number.isFinite(units) || units < 1) return null;
  return roundUpToCent(toCents(packagePrice) / units / 100);
}

// Manager retail override wins; otherwise the margin-safe rounded-up price per base unit is used.
function effectiveSubUnitPrice(product) {
  if (!product || !(product.unitsPerPackage > 1)) return null;
  if (Number.isFinite(product.subUnitPriceOverride)) {
    return Math.round((product.subUnitPriceOverride + Number.EPSILON) * 100) / 100;
  }
  return calculateSubUnitPrice(product.mrp, product.unitsPerPackage);
}

// Vendor price per base unit is kept unrounded so quantity x price matches the package price exactly.
function vendorBasePrice(product) {
  return product.vendorPrice / conversionOf(product);
}

// Stock is stored in base units; a PACKAGE line deducts quantity x conversion and a PIECE (base unit) line deducts quantity.
function toBaseQuantity(product, unit, quantity) {
  return unit === 'PIECE' ? quantity : Math.round(quantity * conversionOf(product) * 1e6) / 1e6;
}

function linePricing(product, item) {
  if (item.unit !== 'PIECE') {
    return {
      unitPrice: product.mrp,
      unitVendorPrice: product.vendorPrice,
      stockQuantity: toBaseQuantity(product, 'PACKAGE', item.quantity),
    };
  }
  const price = effectiveSubUnitPrice(product);
  if (price === null) return null;
  return {
    unitPrice: price,
    unitVendorPrice: vendorBasePrice(product),
    stockQuantity: item.quantity,
  };
}

module.exports = {
  calculateSubUnitPrice, conversionOf, effectiveSubUnitPrice, vendorBasePrice, toBaseQuantity, roundUpToCent, linePricing,
};