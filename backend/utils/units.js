// Base units are always whole: gram (weight), ml (liquid) and pcs (everything else).
const BASE_NAMES = { WEIGHT: 'g', VOLUME: 'ml', COUNT: 'pcs' };
const FIXED_PACKAGE_SIZES = { dozen: 12 };
const NATURAL_UNITS = {
  WEIGHT: [{ name: 'kg', size: 1000 }],
  VOLUME: [{ name: 'litre', size: 1000 }],
  COUNT: [],
};

const ALIASES = {
  kg: ['WEIGHT', 1000], kgs: ['WEIGHT', 1000], kilogram: ['WEIGHT', 1000], kilograms: ['WEIGHT', 1000],
  g: ['WEIGHT', 1], gm: ['WEIGHT', 1], gram: ['WEIGHT', 1], grams: ['WEIGHT', 1],
  l: ['VOLUME', 1000], ltr: ['VOLUME', 1000], litre: ['VOLUME', 1000], liter: ['VOLUME', 1000], litres: ['VOLUME', 1000],
  liters: ['VOLUME', 1000], ml: ['VOLUME', 1], millilitre: ['VOLUME', 1], milliliter: ['VOLUME', 1],
};
const DOZEN_KEYS = ['doz', 'dozen', 'dzn', 'dz'];

const keyOf = (name) => String(name || '').trim().toLowerCase().replace(/\.$/, '');

// Classifies a unit (by name or abbreviation) into its kind and the number of base units it holds.
function classifyUnit(...names) {
  for (const name of names) {
    const hit = ALIASES[keyOf(name)];
    if (hit) return { kind: hit[0], factor: hit[1] };
  }
  return { kind: 'COUNT', factor: 1 };
}

// Dozen is always 12 pieces; every other package unit needs the number entered.
function fixedPackageSize(...names) {
  return names.some((name) => DOZEN_KEYS.includes(keyOf(name))) ? FIXED_PACKAGE_SIZES.dozen : null;
}

function baseUnitName(kind) {
  return BASE_NAMES[kind] || BASE_NAMES.COUNT;
}

// Converts an amount in a unit such as kg or litre into whole base units (g, ml, pcs).
function toBaseUnits(value, ...unitNames) {
  const { factor } = classifyUnit(...unitNames);
  return Math.round(Number(value) * factor);
}

function isWholeNumber(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value);
}

// Largest whole units first, e.g. '1 Crate 2 Dozen 5 pcs (389 pcs)' or '49 kg 500 g'.
function formatStock(quantity, product = {}) {
  const total = Math.round(Number(quantity) || 0);
  const kind = product.baseKind || 'COUNT';
  const base = baseUnitName(kind);
  const conversion = Number.isInteger(product.unitsPerPackage) && product.unitsPerPackage > 1 ? product.unitsPerPackage : 1;
  const natural = NATURAL_UNITS[kind] || [];
  let steps = natural;
  if (kind === 'COUNT') {
    const extra = (product.sellingUnits || []).map((unit) => ({ name: unit.name, size: unit.baseQuantity }));
    const pack = conversion > 1 ? [{ name: product.packageUnitName || 'Pack', size: conversion }] : [];
    steps = [...pack, ...extra].filter((step) => step.size > 1);
  }
  if (kind === 'COUNT' && conversion <= 1 && product.packageUnitName && !steps.length) {
    return `${total} ${product.packageUnitName}`;
  }
  const sorted = [...steps].sort((a, b) => b.size - a.size);
  const sign = total < 0 ? '-' : '';
  let remaining = Math.abs(total);
  const parts = [];
  sorted.forEach((step) => {
    if (parts.some((part) => part.size === step.size)) return;
    const count = Math.floor(remaining / step.size);
    if (count > 0) parts.push({ ...step, count });
    remaining -= count * step.size;
  });
  if (remaining > 0 || !parts.length) parts.push({ name: base, size: 1, count: remaining });
  const text = `${sign}${parts.map((part) => `${part.count} ${part.name}`).join(' ')}`;
  return kind === 'COUNT' && parts.some((part) => part.size > 1) ? `${text} (${total} ${base})` : text;
}

module.exports = {
  baseUnitName, classifyUnit, fixedPackageSize, formatStock, isWholeNumber, toBaseUnits,
};
