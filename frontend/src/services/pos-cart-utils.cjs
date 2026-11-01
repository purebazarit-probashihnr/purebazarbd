const { roundHalfUp } = require('./money-format.cjs');
const { formatStock } = require('./stock-units.cjs');

const STOCK_LIMIT_MESSAGE = 'Stock limit reached for this product';

// Base units (g, ml or pcs) per package; stock is always held in base units.
function conversionOf(item) {
  const units = Number(item.unitsPerPackage);
  return Number.isInteger(units) && units >= 1 ? units : 1;
}

const extraUnitsOf = (item) => (item.sellingUnits || []).filter((unit) => Number.isInteger(unit.baseQuantity) && unit.baseQuantity >= 1);

// Exact price of one base unit; only the line amount is rounded to whole taka.
function basePrice(item) {
  const explicit = Number(item.subUnitPrice);
  if (Number.isFinite(explicit)) return explicit;
  return Number(item.mrp) / conversionOf(item);
}

function canSellPieces(item) {
  return conversionOf(item) > 1 || extraUnitsOf(item).length > 0;
}

// Package, every extra unit and the base unit, each with the price of one such unit.
function unitOptions(item) {
  const options = [];
  if (conversionOf(item) > 1) {
    options.push({
      key: 'PACKAGE', unit: 'PACKAGE', label: item.packageUnitName || 'Box', baseQuantity: conversionOf(item), price: Number(item.mrp),
    });
  }
  extraUnitsOf(item).forEach((extra) => options.push({
    key: `EXTRA:${extra.name}`, unit: 'EXTRA', unitName: extra.name, label: extra.name, baseQuantity: extra.baseQuantity,
    price: basePrice(item) * extra.baseQuantity,
  }));
  if (!options.length) {
    return [{
      key: 'PACKAGE', unit: 'PACKAGE', label: item.packageUnitName || item.baseUnitName || 'pcs', baseQuantity: 1, price: Number(item.mrp),
    }];
  }
  options.push({
    key: 'PIECE', unit: 'PIECE', label: item.baseUnitName || 'pcs', baseQuantity: 1, price: conversionOf(item) > 1 ? basePrice(item) : Number(item.mrp),
  });
  return options;
}

function currentOption(item) {
  const options = unitOptions(item);
  const key = item.unit === 'EXTRA' ? `EXTRA:${item.unitName}` : (item.unit || 'PACKAGE');
  return options.find((option) => option.key === key) || options[0];
}

const isPiece = (item) => currentOption(item).key === 'PIECE';
const unitKeyOf = (item) => currentOption(item).key;

// Stock expressed in the unit currently selected for the cart line.
function availableStock(item) {
  return Math.floor(Math.max(Math.round(Number(item.stock) || 0), 0) / currentOption(item).baseQuantity);
}

// Returns a whole quantity between 1 and the available stock.
function clampQuantity(value, stock) {
  const parsed = Math.floor(Number(value));
  const whole = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  const limit = Math.floor(Number(stock));
  if (Number.isFinite(limit) && whole > limit) return { quantity: Math.max(limit, 0), limited: true };
  return { quantity: whole, limited: false };
}

// Sells whole packages when any are in stock, otherwise falls back to the largest unit that fits.
function defaultSelection(item) {
  const options = unitOptions(item);
  const fit = options.find((option) => (Number(item.stock) || 0) >= option.baseQuantity) || options[options.length - 1];
  return { unit: fit.unit, unitName: fit.unitName };
}

function unitPrice(item) {
  return currentOption(item).price;
}

// Whole taka, rounded half up per line.
function lineTotal(item) {
  return roundHalfUp(unitPrice(item) * Number(item.quantity || 0));
}

function hasStockProblem(items) {
  return items.some((item) => availableStock(item) <= 0 || Number(item.quantity) > availableStock(item));
}

// Shows stock like "1 Crate 2 Dozen 5 pcs (377 pcs)".
function stockLabel(item) {
  return formatStock(item.stock, item);
}

// Cart line fields copied from a catalog item; price and stock stay in the package and base units of the product.
function cartShape(product, stock) {
  return {
    productId: String(product.productId),
    name: product.displayName || product.name,
    barcode: product.barcode,
    mrp: Number(product.mrp),
    unitsPerPackage: product.unitsPerPackage,
    packageUnitName: product.packageUnitName,
    baseUnitName: product.baseUnitName,
    baseKind: product.baseKind,
    sellingUnits: product.sellingUnits || [],
    subUnitPrice: product.subUnitPrice,
    stock,
  };
}

module.exports = {
  STOCK_LIMIT_MESSAGE, availableStock, canSellPieces, cartShape, clampQuantity, conversionOf, currentOption, defaultSelection,
  hasStockProblem, isPiece, lineTotal, stockLabel, unitKeyOf, unitOptions, unitPrice,
};
