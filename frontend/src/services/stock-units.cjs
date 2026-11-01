const isMultiUnit = (unitsPerPackage) => Number.isFinite(Number(unitsPerPackage)) && Number(unitsPerPackage) > 1;
const round6 = (value) => Math.round(value * 1e6) / 1e6;

// Splits a stored base-unit quantity (pcs, kg) into whole packages and loose base units.
function splitQuantity(quantity, unitsPerPackage) {
  const value = Number(quantity) || 0;
  if (!isMultiUnit(unitsPerPackage)) return { boxes: value, pieces: 0 };
  const sign = value < 0 ? -1 : 1;
  const absolute = round6(Math.abs(value));
  const boxes = Math.floor(round6(absolute / Number(unitsPerPackage)));
  return { boxes: sign * boxes, pieces: sign * round6(absolute - boxes * Number(unitsPerPackage)) };
}

// Converts packages + loose base units back to the stored base-unit quantity.
function combineQuantity(boxes, pieces, unitsPerPackage) {
  const b = Number(boxes) || 0;
  const p = Number(pieces) || 0;
  if (!isMultiUnit(unitsPerPackage)) return b;
  return round6(b * Number(unitsPerPackage) + p);
}

// Shows stock like "15 Box (90 pcs)"; products without a conversion show a plain number.
function formatStock(quantity, unitsPerPackage, packageUnitName, baseUnitName) {
  const value = Number(quantity) || 0;
  if (!isMultiUnit(unitsPerPackage)) return String(round6(value));
  const { boxes } = splitQuantity(value, unitsPerPackage);
  return `${boxes} ${packageUnitName || 'Box'} (${round6(value)} ${baseUnitName || 'pcs'})`;
}

module.exports = { isMultiUnit, splitQuantity, combineQuantity, formatStock };