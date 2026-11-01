const { Unit } = require('../models');
const { baseUnitName, classifyUnit, formatStock } = require('./units');

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

// baseKind is WEIGHT (grams), VOLUME (ml) or COUNT (pcs); stock is always held in whole base units.
function displayFields(product, labels) {
  const key = product.unitId?.toString();
  const unitLabel = labels.get(key) || null;
  const baseKey = product.baseUnitId?.toString();
  const baseKind = baseKey ? classifyUnit(labels.get(baseKey), labels.names?.get(baseKey)).kind : 'COUNT';
  const fields = {
    baseUnitLabel: labels.get(baseKey) || null,
    baseKind,
    baseUnitName: baseUnitName(baseKind),
    unitLabel,
    packageUnitName: labels.names?.get(key) || null,
    sellingUnits: (product.sellingUnits || []).map((unit) => ({ name: unit.name, baseQuantity: unit.baseQuantity })),
    displayName: formatDisplayName(product.name, unitLabel),
  };
  return fields;
}

function stockLabelFor(product, fields, quantity) {
  return formatStock(quantity, { ...fields, unitsPerPackage: product.unitsPerPackage });
}

module.exports = {
  formatDisplayName, unitLabelMap, displayFields, stockLabelFor,
};
