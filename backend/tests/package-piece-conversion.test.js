const { linePricing, effectiveSubUnitPrice, packageUnitPrice } = require('../utils/piecePricing');
const { calculateBill } = require('../services/billEngine');
const { availableStock } = require('../../frontend/src/services/pos-cart-utils.cjs');
const { formatStock, combineQuantity } = require('../../frontend/src/services/stock-units.cjs');

// Saved prices are for Unit Quantity / Value = 20 boxes; each box holds 6 pieces.
const tokma = {
  unitValue: 20, unitsPerPackage: 6, vendorPrice: 28800, mrp: 33600,
};
const piecesOf = (boxes) => Math.round(boxes * tokma.unitsPerPackage * 1e6) / 1e6;

describe('package to piece conversion (Tokma)', () => {
  it('derives price per box and per piece from the unit quantity', () => {
    expect(packageUnitPrice(tokma)).toBe(1680);
    expect(effectiveSubUnitPrice(tokma)).toBe(280);
  });

  it('shows an outlet with 15 boxes as 90 pcs in the POS', () => {
    expect(availableStock({ ...tokma, stock: 15, unit: 'PIECE', subUnitPrice: 280 })).toBe(90);
    expect(availableStock({ ...tokma, stock: 15, unit: 'PACKAGE', subUnitPrice: 280 })).toBe(15);
    expect(formatStock(15, tokma.unitsPerPackage, 'Box')).toBe('15 Box');
  });

  it('selling 1 box and 2 pcs deducts 8 pcs and returning restores it', () => {
    const box = linePricing(tokma, { unit: 'PACKAGE', quantity: 1 });
    const pieces = linePricing(tokma, { unit: 'PIECE', quantity: 2 });
    const sold = box.stockQuantity + pieces.stockQuantity;
    expect(piecesOf(sold)).toBe(8);
    const remaining = 15 - sold;
    expect(piecesOf(remaining)).toBe(82);
    expect(formatStock(remaining, 6, 'Box')).toBe('13 Box and 4 Pcs');
    expect(piecesOf(remaining + sold)).toBe(90);
    expect(combineQuantity(13, 4, 6)).toBeCloseTo(remaining, 10);
  });

  it('selling 1 pc deducts exactly 1 pc', () => {
    const { stockQuantity } = linePricing(tokma, { unit: 'PIECE', quantity: 1 });
    expect(piecesOf(stockQuantity)).toBe(1);
  });

  it('records the vendor payable per piece as 240', () => {
    const pricing = linePricing(tokma, { unit: 'PIECE', quantity: 1 });
    expect(pricing.unitVendorPrice).toBe(240);
    const bill = calculateBill({
      items: [{
        productId: 'p1', vendorId: 'v1', ownerType: 'VENDOR', quantity: 1,
        mrp: pricing.unitPrice, vendorPrice: pricing.unitVendorPrice,
      }],
      paymentMethod: 'CASH',
    });
    expect(bill.ledgerLines[0].vendorPayable).toBe(240);
  });

  it('warehouse 5 boxes + outlet 15 boxes = 120 pcs in total', () => {
    expect(piecesOf(5 + 15)).toBe(120);
  });
});
