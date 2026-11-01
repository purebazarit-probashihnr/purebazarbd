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

test('Dozen price: qty 10, 12 per dozen, MRP 1600 -> 12 pieces per package, base cost 13.33', () => {
  const total = totalPieces('12');
  assert.equal(total, '12');
  const base = basePieceCost(1600, '10', total);
  assert.equal(r2(base), '13.33');
  assert.ok(14 >= base);
});

test('Tokma: 6 pcs per box, MRP 33600 for 20 boxes -> 6 pieces, 280 per piece', () => {
  assert.equal(totalPieces('6'), '6');
  assert.equal(r2(basePieceCost(33600, '20', 6)), '280.00');
});

test('Unit quantity defaults to 1 when blank', () => {
  assert.equal(r2(basePieceCost(1000, '', 250)), '4.00');
});

test('invalid input gives no total', () => {
  assert.equal(totalPieces(''), '');
  assert.equal(totalPieces('0'), '');
  assert.equal(totalPieces('1'), '');
  assert.equal(basePieceCost(100, '1', ''), null);
});
