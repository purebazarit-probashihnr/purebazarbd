const DOZEN_KEYS = ['doz', 'dozen', 'dzn'];

// Convenience default only; the user can always change it.
function defaultPiecesPerPackage(unit) {
  if (!unit) return '';
  const keys = [unit.name, unit.abbreviation].map((v) => String(v || '').trim().toLowerCase().replace(/\.$/, ''));
  return keys.some((key) => DOZEN_KEYS.includes(key)) ? '12' : '';
}

// Base units per package; returns '' unless it is a number above 1.
function totalPieces(piecesPerPackage) {
  const per = Number(piecesPerPackage);
  if (piecesPerPackage === '' || !Number.isFinite(per) || per <= 1) return '';
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