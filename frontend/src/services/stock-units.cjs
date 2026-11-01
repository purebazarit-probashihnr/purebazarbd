// Mirrors backend/utils/units.js: stock is always whole base units (g, ml or pcs).
const KEYS = {
  kg: { kind: 'WEIGHT', factor: 1000 }, kilogram: { kind: 'WEIGHT', factor: 1000 },
  g: { kind: 'WEIGHT', factor: 1 }, gram: { kind: 'WEIGHT', factor: 1 },
  l: { kind: 'VOLUME', factor: 1000 }, litre: { kind: 'VOLUME', factor: 1000 }, liter: { kind: 'VOLUME', factor: 1000 },
  ml: { kind: 'VOLUME', factor: 1 }, millilitre: { kind: 'VOLUME', factor: 1 },
};
const BASE_NAME = { WEIGHT: 'g', VOLUME: 'ml', COUNT: 'pcs' };
const NATURAL = { WEIGHT: [{ name: 'kg', size: 1000 }], VOLUME: [{ name: 'litre', size: 1000 }] };
const FIXED = { doz: 12, dozen: 12, dzn: 12 };
const keyOf = (name) => String(name || '').trim().toLowerCase().replace(/\.$/, '');

function classifyUnit(...names) {
  const hit = names.map(keyOf).find((key) => KEYS[key]);
  return hit ? { ...KEYS[hit] } : { kind: 'COUNT', factor: 1 };
}

// Pieces per package when the unit fixes it (Dozen = 12), otherwise null.
function fixedPackageSize(...names) {
  const hit = names.map(keyOf).find((key) => FIXED[key]);
  return hit ? FIXED[hit] : null;
}

const baseUnitName = (kind) => BASE_NAME[kind] || 'pcs';

// Converts an amount typed in kg or litre into whole grams or millilitres.
function toBaseUnits(value, ...unitNames) {
  return Math.round(Number(value) * classifyUnit(...unitNames).factor);
}

const isMultiUnit = (unitsPerPackage) => Number.isInteger(Number(unitsPerPackage)) && Number(unitsPerPackage) > 1;

// Largest whole units first, e.g. '1 Crate 2 Dozen 5 pcs (377 pcs)' or '49 kg 500 g'.
function formatStock(quantity, product = {}) {
  const total = Math.round(Number(quantity) || 0);
  const kind = product.baseKind || 'COUNT';
  const base = baseUnitName(kind);
  const conversion = isMultiUnit(product.unitsPerPackage) ? Number(product.unitsPerPackage) : 1;
  let steps = NATURAL[kind] || [];
  if (kind === 'COUNT') {
    const extra = (product.sellingUnits || []).map((unit) => ({ name: unit.name, size: unit.baseQuantity }));
    const pack = conversion > 1 ? [{ name: product.packageUnitName || 'Pack', size: conversion }] : [];
    steps = [...pack, ...extra].filter((step) => step.size > 1);
    if (conversion <= 1 && product.packageUnitName && !steps.length) return `${total} ${product.packageUnitName}`;
  }
  let remaining = Math.abs(total);
  const parts = [];
  [...steps].sort((a, b) => b.size - a.size).forEach((step) => {
    if (parts.some((part) => part.size === step.size)) return;
    const count = Math.floor(remaining / step.size);
    if (count > 0) parts.push({ ...step, count });
    remaining -= count * step.size;
  });
  if (remaining > 0 || !parts.length) parts.push({ name: base, size: 1, count: remaining });
  const text = `${total < 0 ? '-' : ''}${parts.map((part) => `${part.count} ${part.name}`).join(' ')}`;
  return kind === 'COUNT' && parts.some((part) => part.size > 1) ? `${text} (${total} ${base})` : text;
}

// Splits whole base units into whole packages and loose base units (used by stock count inputs).
function splitQuantity(quantity, unitsPerPackage) {
  const value = Math.round(Number(quantity) || 0);
  if (!isMultiUnit(unitsPerPackage)) return { boxes: value, pieces: 0 };
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const boxes = Math.floor(absolute / Number(unitsPerPackage));
  return { boxes: sign * boxes, pieces: sign * (absolute - boxes * Number(unitsPerPackage)) };
}

function combineQuantity(boxes, pieces, unitsPerPackage) {
  const b = Math.round(Number(boxes) || 0);
  const p = Math.round(Number(pieces) || 0);
  if (!isMultiUnit(unitsPerPackage)) return b;
  return b * Number(unitsPerPackage) + p;
}

module.exports = {
  baseUnitName, classifyUnit, combineQuantity, fixedPackageSize, formatStock, isMultiUnit, splitQuantity, toBaseUnits,
};
