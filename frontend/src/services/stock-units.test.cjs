const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  splitQuantity, combineQuantity, formatStock, fixedPackageSize, toBaseUnits,
} = require('./stock-units.cjs');
const { formatMoney, roundHalfUp } = require('./money-format.cjs');

const crate = { unitsPerPackage: 360, packageUnitName: 'Crate', sellingUnits: [{ name: 'Dozen', baseQuantity: 12 }] };
const sack = { baseKind: 'WEIGHT', unitsPerPackage: 50000, packageUnitName: 'Sack' };

describe('whole-number stock display', () => {
  it('shows the largest whole units first', () => {
    assert.equal(formatStock(377, crate), '1 Crate 1 Dozen 5 pcs (377 pcs)');
    assert.equal(formatStock(90, { unitsPerPackage: 6, packageUnitName: 'Box' }), '15 Box (90 pcs)');
    assert.equal(formatStock(49500, sack), '49 kg 500 g');
    assert.equal(formatStock(50000, sack), '50 kg');
    assert.equal(formatStock(7, {}), '7 pcs');
  });

  it('Dozen is always 12 and kg/litre convert to g/ml', () => {
    assert.equal(fixedPackageSize('Dozen'), 12);
    assert.equal(fixedPackageSize('Box'), null);
    assert.equal(toBaseUnits(50, 'kg'), 50000);
    assert.equal(toBaseUnits(1.5, 'litre'), 1500);
    assert.equal(toBaseUnits(12, 'pcs'), 12);
  });

  it('splits and combines whole packages with loose base units', () => {
    assert.deepEqual(splitQuantity(680, 250), { boxes: 2, pieces: 180 });
    assert.equal(combineQuantity(2, 3, 6), 15);
    assert.deepEqual(splitQuantity(combineQuantity(3, 200, 250), 250), { boxes: 3, pieces: 200 });
  });

  it('never prints a decimal point in money or quantity', () => {
    assert.equal(roundHalfUp(129.75), 130);
    assert.equal(formatMoney(1206.5), '৳1,207');
    assert.equal(formatMoney(-0.4), '৳0');
    [0, 5, 377, 49500].forEach((quantity) => {
      assert.doesNotMatch(formatStock(quantity, crate), /\./);
      assert.doesNotMatch(formatStock(quantity, sack), /\./);
    });
  });
});
