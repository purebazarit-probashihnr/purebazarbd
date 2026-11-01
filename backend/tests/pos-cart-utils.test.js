const {
  availableStock, clampQuantity, defaultSelection, hasStockProblem, lineTotal, stockLabel, unitPrice,
} = require('../../frontend/src/services/pos-cart-utils.cjs');
const { getCode39Runs } = require('../../frontend/src/services/code39.cjs');

describe('Code 39 receipt barcode', () => {
  it('encodes an order number with start/stop characters', () => {
    const runs = getCode39Runs('POS-123');
    expect(runs.filter((run) => run.bar).length).toBe(5 * 9);
    expect(() => getCode39Runs('a b')).toThrow();
  });
});

describe('POS cart quantity rules', () => {
  it('never lets quantity reach 0, 0.01 or negative values', () => {
    [0, 0.01, -3, '', 'abc', NaN, null].forEach((value) => {
      expect(clampQuantity(value, 10).quantity).toBe(1);
    });
  });

  it('truncates decimals to whole units', () => {
    expect(clampQuantity(2.9, 10)).toEqual({ quantity: 2, limited: false });
  });

  it('caps quantity at available stock', () => {
    expect(clampQuantity(8, 5)).toEqual({ quantity: 5, limited: true });
    expect(clampQuantity(5, 5)).toEqual({ quantity: 5, limited: false });
  });

  it('flags stock-out and over-stock lines', () => {
    expect(hasStockProblem([{ stock: 0, quantity: 1 }])).toBe(true);
    expect(hasStockProblem([{ stock: 2, quantity: 3 }])).toBe(true);
    expect(hasStockProblem([{ stock: 2, quantity: 2 }])).toBe(false);
  });

  it('uses base-unit stock and price for Toffen Tablet sold by the piece', () => {
    const toffen = {
      stock: 525, mrp: 2100, unitsPerPackage: 210, subUnitPrice: 10, unit: 'PIECE', quantity: 525,
    };
    expect(availableStock(toffen)).toBe(525);
    expect(unitPrice(toffen)).toBe(10);
    expect(lineTotal({ ...toffen, quantity: 3 })).toBe(30);
    expect(hasStockProblem([toffen])).toBe(false);
    expect(hasStockProblem([{ ...toffen, quantity: 526 }])).toBe(true);
    expect(availableStock({ ...toffen, unit: 'PACKAGE' })).toBe(2);
    expect(lineTotal({ ...toffen, unit: 'PACKAGE', quantity: 1 })).toBe(2100);
  });

  it('shows stock as whole packages plus loose pieces and defaults to pieces when no whole package is left', () => {
    const box = {
      stock: 95, unitsPerPackage: 6, packageUnitName: 'Box', baseUnitName: 'pcs', subUnitPrice: 5, mrp: 30,
    };
    expect(stockLabel(box)).toBe('15 Box 5 pcs (95 pcs)');
    expect(defaultSelection(box).unit).toBe('PACKAGE');
    expect(defaultSelection({ ...box, stock: 4 }).unit).toBe('PIECE');
  });

  it('keeps weight quantities whole by selling kg products in grams', () => {
    const rice = {
      stock: 60000, unitsPerPackage: 25000, baseKind: 'WEIGHT', subUnitPrice: 0.1, mrp: 2500, unit: 'PIECE',
    };
    expect(availableStock(rice)).toBe(60000);
    expect(clampQuantity(2.5, availableStock(rice))).toEqual({ quantity: 2, limited: false });
    expect(availableStock({ ...rice, unit: 'PACKAGE' })).toBe(2);
  });

  it('prices a package at the package MRP and a base unit at the derived price', () => {
    const product = { mrp: 1557, unitsPerPackage: 12, subUnitPrice: 129.75 };
    expect(unitPrice({ ...product, unit: 'PACKAGE' })).toBe(1557);
    expect(lineTotal({ ...product, unit: 'PIECE', quantity: 2 })).toBe(260);
  });
});