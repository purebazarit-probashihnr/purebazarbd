const STOCK_LIMIT_MESSAGE = 'Stock limit reached for this product';

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const round6 = (value) => Math.round(Number(value) * 1e6) / 1e6;

// Base units (pcs, kg) per package; stock is always held in base units.
function conversionOf(item) {
  const units = Number(item.unitsPerPackage);
  return Number.isFinite(units) && units >= 1 ? units : 1;
}

function canSellPieces(item) {
  return conversionOf(item) > 1 && Number.isFinite(Number(item.subUnitPrice));
}

function isPiece(item) {
  return item.unit === 'PIECE' && canSellPieces(item);
}

// Counted units are sold whole; measured units (kg) may be fractional.
function allowsFraction(item) {
  return isPiece(item) && item.baseUnitMeasured === true;
}

// Returns a quantity between the minimum step and the available stock.
function clampQuantity(value, stock, fractional = false) {
  const parsed = fractional ? round6(Number(value)) : Math.floor(Number(value));
  const minimum = fractional ? 0.001 : 1;
  const whole = Number.isFinite(parsed) && parsed >= minimum ? parsed : minimum;
  const limit = fractional ? round6(Number(stock)) : Math.floor(Number(stock));
  if (Number.isFinite(limit) && whole > limit) return { quantity: Math.max(limit, 0), limited: true };
  return { quantity: whole, limited: false };
}

// Stock expressed in the unit currently selected for the cart line.
function availableStock(item) {
  const base = round6(Number(item.stock) || 0);
  if (isPiece(item)) return allowsFraction(item) ? base : Math.floor(base);
  return Math.floor(round6(base / conversionOf(item)));
}

// Sells whole packages when any are in stock, otherwise falls back to the base unit.
function defaultUnit(item) {
  const hasPackage = availableStock({ ...item, unit: 'PACKAGE' }) >= 1;
  return !hasPackage && canSellPieces(item) ? 'PIECE' : 'PACKAGE';
}

function unitPrice(item) {
  return isPiece(item) ? Number(item.subUnitPrice) : round2(Number(item.mrp));
}

function lineTotal(item) {
  return round2(unitPrice(item) * Number(item.quantity || 0));
}

function hasStockProblem(items) {
  return items.some((item) => availableStock(item) <= 0 || Number(item.quantity) > availableStock(item));
}

// Shows stock like "15 Box (90 pcs)".
function stockLabel(item) {
  const base = round6(Number(item.stock) || 0);
  const baseName = item.baseUnitName || 'pcs';
  if (conversionOf(item) <= 1) return `${base} ${item.packageUnitName || baseName}`;
  const packages = Math.floor(round6(base / conversionOf(item)));
  return `${packages} ${item.packageUnitName || 'box'} (${base} ${baseName})`;
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
    baseUnitMeasured: product.baseUnitMeasured === true,
    subUnitPrice: product.subUnitPrice,
    stock,
  };
}

module.exports = {
  STOCK_LIMIT_MESSAGE, allowsFraction, availableStock, canSellPieces, cartShape, clampQuantity, conversionOf, defaultUnit,
  hasStockProblem, isPiece, lineTotal, stockLabel, unitPrice,
};