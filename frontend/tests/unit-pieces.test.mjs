import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { defaultPiecesPerPackage, totalPieces, basePieceCost } = createRequire(import.meta.url)('../src/services/unit-pieces.cjs');

const r2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

test('Dozen defaults to 12 pieces per package; other units stay open', () => {
  assert.equal(defaultPiecesPerPackage({ name: 'Dozen', abbreviation: 'Doz' }), '12');
  assert.equal(defaultPiecesPerPackage({ name: 'Box', abbreviation: 'box' }), '');
  assert.equal(defaultPiecesPerPackage(null), '');
});

test('price per base unit is the package price divided by the conversion', () => {
  assert.equal(totalPieces('12'), '12');
  assert.equal(r2(basePieceCost(1600, 12)), '133.33');
  assert.equal(r2(basePieceCost(960, 120)), '8.00');
  assert.equal(r2(basePieceCost(2500, 25)), '100.00');
  assert.equal(totalPieces('12.5'), '12.5');
});

test('invalid input gives no total', () => {
  assert.equal(totalPieces(''), '');
  assert.equal(totalPieces('0'), '');
  assert.equal(totalPieces('1'), '');
  assert.equal(basePieceCost(100, ''), null);
  assert.equal(basePieceCost(100, 0), null);
});