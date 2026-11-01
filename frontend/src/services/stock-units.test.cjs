const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { splitQuantity, combineQuantity, formatStock } = require('./stock-units.cjs');

describe('stock units (stock is stored in base units)', () => {
  it('formats stock as packages with the base unit total', () => {
    assert.equal(formatStock(90, 6, 'Box'), '15 Box (90 pcs)');
    assert.equal(formatStock(77, 25, 'Sack', 'kg'), '3 Sack (77 kg)');
    assert.equal(formatStock(30, 30, 'Tray'), '1 Tray (30 pcs)');
    assert.equal(formatStock(5, 120, 'Box'), '0 Box (5 pcs)');
  });
  it('leaves single-unit products as plain numbers', () => {
    assert.equal(formatStock(7, undefined), '7');
    assert.equal(formatStock(7.5, 1), '7.5');
  });
  it('splits and combines packages and loose base units', () => {
    assert.deepEqual(splitQuantity(680, 250), { boxes: 2, pieces: 180 });
    assert.equal(combineQuantity(2, 3, 6), 15);
    assert.deepEqual(splitQuantity(combineQuantity(3, 200, 250), 250), { boxes: 3, pieces: 200 });
  });
});