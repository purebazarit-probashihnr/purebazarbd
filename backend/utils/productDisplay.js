const { Unit } = require('../models');

// Counted units (pcs, dozen) must be sold whole; measured units (kg, litre) may be fractional.
function isCountedUnit(...names) {
  return names.some((name) => /^(pcs?|pieces?|dozens?|dz)$/i.test(String(name || '').trim()));
}

function formatDisplayName(name, unitLabel) {
  return unitLabel ? `${name} [${unitLabel}]` : name;
}

// Resolves unit abbreviations for products so UI names can show them without changing stored names.
async function unitLabelMap(products) {
  const ids = [...new Set(products.flatMap((product) => [product.unitId?.toString(), product.baseUnitId?.toString()]).filter(Boolean))];
  const labels = new Map();
  labels.names = new Map();
  if (!ids.length) return labels;
  const units = await Unit.find({ _id: { $in: ids } }).select('name abbreviation').lean();
  units.forEach((unit) => {
    labels.set(unit._id.toString(), unit.abbreviation || unit.name);
    labels.names.set(unit._id.toString(), unit.name);
  });
  return labels;
}

// packageUnitName is the full base unit name (Dozen, Box, Bag...) used for the primary pack unit in POS and stock count.
function displayFields(product, labels) {
  const key = product.unitId?.toString();
  const unitLabel = labels.get(key) || null;
  const baseKey = product.baseUnitId?.toString();
  return {
    baseUnitLabel: labels.get(baseKey) || null,
    baseUnitName: labels.names?.get(baseKey) || null,
    baseUnitMeasured: Boolean(baseKey) && !isCountedUnit(labels.get(baseKey), labels.names?.get(baseKey)),
    unitLabel,
    packageUnitName: labels.names?.get(key) || null,
    displayName: formatDisplayName(product.name, unitLabel),
  };
}

module.exports = { isCountedUnit, formatDisplayName, unitLabelMap, displayFields };
