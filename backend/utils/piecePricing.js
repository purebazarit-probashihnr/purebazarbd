// unitsPerPackage is the whole number of base units (pcs, g, ml) per package. Prices are saved per package.
function conversionOf(product) {
  const units = Number(product && product.unitsPerPackage);
  return Number.isInteger(units) && units >= 1 ? units : 1;
}

// Price of one base unit may keep fractions; only line amounts are rounded to whole taka.
function calculateSubUnitPrice(packagePrice, unitsPerPackage) {
  const units = Number(unitsPerPackage);
  if (!Number.isFinite(units) || units < 1) return null;
  return Number(packagePrice) / units;
}

// Manager retail override wins; otherwise the exact price per base unit is used.
function effectiveSubUnitPrice(product) {
  if (!product || !(product.unitsPerPackage > 1)) return null;
  if (Number.isFinite(product.subUnitPriceOverride)) return product.subUnitPriceOverride;
  return calculateSubUnitPrice(product.mrp, product.unitsPerPackage);
}

// Vendor price per base unit is kept unrounded; line payables are rounded to whole taka.
function vendorBasePrice(product) {
  return product.vendorPrice / conversionOf(product);
}

// Stock is stored in whole base units; a PACKAGE line deducts quantity x conversion.
function toBaseQuantity(product, unit, quantity) {
  return unit === 'PIECE' ? quantity : quantity * conversionOf(product);
}

function sellingUnitOf(product, name) {
  const wanted = String(name || '').trim().toLowerCase();
  return (product.sellingUnits || []).find((unit) => String(unit.name).trim().toLowerCase() === wanted) || null;
}

// Resolves the unit a cart line is sold in to its number of base units and price for one such unit.
function linePricing(product, item) {
  const conversion = conversionOf(product);
  if (item.unit === 'EXTRA') {
    const extra = sellingUnitOf(product, item.unitName);
    if (!extra) return null;
    const basePrice = conversion > 1 ? effectiveSubUnitPrice(product) : product.mrp;
    return {
      unitPrice: basePrice * extra.baseQuantity,
      unitVendorPrice: product.vendorPrice * extra.baseQuantity / conversion,
      stockQuantity: item.quantity * extra.baseQuantity,
      unitBaseQuantity: extra.baseQuantity,
      unitName: extra.name,
    };
  }
  if (item.unit !== 'PIECE') {
    return {
      unitPrice: product.mrp,
      unitVendorPrice: product.vendorPrice,
      stockQuantity: toBaseQuantity(product, 'PACKAGE', item.quantity),
      unitBaseQuantity: conversion,
    };
  }
  // A product sold only by the base unit and extra units has an MRP that is already per base unit.
  const price = conversion === 1 && (product.sellingUnits || []).length ? product.mrp : effectiveSubUnitPrice(product);
  if (price === null) return null;
  return {
    unitPrice: price,
    unitVendorPrice: vendorBasePrice(product),
    stockQuantity: item.quantity,
    unitBaseQuantity: 1,
  };
}

module.exports = {
  calculateSubUnitPrice, conversionOf, effectiveSubUnitPrice, vendorBasePrice, toBaseQuantity, linePricing, sellingUnitOf,
};
