const DOZEN_KEYS = ['doz', 'dozen', 'dzn'];

// Convenience default only; the user can always change it.
function defaultPiecesPerPackage(unit) {
  if (!unit) return '';
  const keys = [unit.name, unit.abbreviation].map((v) => String(v || '').trim().toLowerCase().replace(/\.$/, ''));
  return keys.some((key) => DOZEN_KEYS.includes(key)) ? '12' : '';
}

// Pieces per package only; Unit Quantity / Value never multiplies stock. Returns '' when not a whole number above 1.
function totalPieces(piecesPerPackage) {
  const per = Number(piecesPerPackage);
  if (piecesPerPackage === '' || !Number.isInteger(per) || per <= 1) return '';
  return String(per);
}

// Exact (unrounded) cost of one piece: price / unit quantity / pieces per package.
function basePieceCost(mrp, unitQuantity, pieces) {
  const price = Number(mrp);
  const quantity = unitQuantity === '' || unitQuantity === undefined ? 1 : Number(unitQuantity);
  const count = Number(pieces);
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(count) || count <= 0) return null;
  return price / quantity / count;
}

module.exports = { defaultPiecesPerPackage, totalPieces, basePieceCost };
