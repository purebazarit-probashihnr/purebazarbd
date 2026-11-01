const { fixedPackageSize } = require('./stock-units.cjs');

// Dozen fixes the number at 12; the form never asks for it. Other units return '' (the number is required).
function defaultPiecesPerPackage(unit) {
  if (!unit) return '';
  const fixed = fixedPackageSize(unit.name, unit.abbreviation);
  return fixed ? String(fixed) : '';
}

// Base units per package; returns '' unless it is a whole number above 1.
function totalPieces(piecesPerPackage) {
  const per = Number(piecesPerPackage);
  if (piecesPerPackage === '' || !Number.isInteger(per) || per <= 1) return '';
  return String(per);
}

// Exact (unrounded) price of one base unit: package price / base units per package.
function basePieceCost(packagePrice, pieces) {
  const price = Number(packagePrice);
  const count = Number(pieces);
  if (!Number.isFinite(price) || !Number.isFinite(count) || count <= 0) return null;
  return price / count;
}

module.exports = { defaultPiecesPerPackage, totalPieces, basePieceCost };