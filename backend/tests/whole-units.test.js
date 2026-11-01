const { calculateBill } = require('../services/billEngine');
const { linePricing } = require('../utils/piecePricing');
const { formatStock, fixedPackageSize } = require('../utils/units');
const { formatMoney, roundHalfUp } = require('../utils/money');

const settings = { vatEnabled: false };
const bill = (items) => calculateBill({ items, paymentMethod: 'CASH', settings });

// Builds a bill item the way the POS bill service does, and returns the stock it deducts.
function sell(product, cart) {
  const priced = linePricing(product, cart);
  return {
    stock: priced.stockQuantity,
    item: {
      productId: 'p', ownerType: product.ownerType, vendorId: 'v', quantity: cart.quantity,
      mrp: priced.unitPrice, vendorPrice: priced.unitVendorPrice,
    },
  };
}

const dozenProduct = {
  ownerType: 'VENDOR', mrp: 1200, vendorPrice: 1000, unitsPerPackage: fixedPackageSize('Dozen'),
  packageUnitName: 'Dozen',
};
const crate = {
  ownerType: 'VENDOR', mrp: 3600, vendorPrice: 3000, unitsPerPackage: 360, packageUnitName: 'Crate',
  sellingUnits: [{ name: 'Dozen', baseQuantity: 12 }],
};
const sack = {
  ownerType: 'VENDOR', mrp: 5000, vendorPrice: 4500, unitsPerPackage: 50000, packageUnitName: 'Sack',
  baseKind: 'WEIGHT', sellingUnits: [{ name: 'kg', baseQuantity: 1000 }],
};

describe('Dozen, extra units and whole numbers', () => {
  it('gives a Dozen product 12 pcs without entering pieces per package', () => {
    expect(fixedPackageSize('Dozen')).toBe(12);
    expect(fixedPackageSize('doz')).toBe(12);
    expect(fixedPackageSize('Box')).toBeNull();
  });

  it('1 dozen + 3 pcs sold from 10 dozen leaves 105 pcs', () => {
    const stock = 10 * 12;
    const sold = sell(dozenProduct, { quantity: 1, unit: 'PACKAGE' }).stock
      + sell(dozenProduct, { quantity: 3, unit: 'PIECE' }).stock;
    expect(stock - sold).toBe(105);
    expect(formatStock(stock - sold, { ...dozenProduct })).toBe('8 Dozen 9 pcs (105 pcs)');
  });

  it('a crate of 360 sold as 2 dozen + 5 pcs deducts 29 pcs', () => {
    const dozens = sell(crate, { quantity: 2, unit: 'EXTRA', unitName: 'Dozen' });
    const pieces = sell(crate, { quantity: 5, unit: 'PIECE' });
    expect(dozens.stock + pieces.stock).toBe(29);
    expect(formatStock(360 - 29, crate)).toBe('27 Dozen 7 pcs (331 pcs)');
  });

  it('selling 500 g from a 50 kg sack deducts 500 g and shows 49 kg 500 g', () => {
    const sold = sell(sack, { quantity: 500, unit: 'PIECE' });
    expect(sold.stock).toBe(500);
    expect(formatStock(50000 - sold.stock, sack)).toBe('49 kg 500 g');
    expect(formatStock(50000, sack)).toBe('50 kg');
  });

  it('vendor payable stays within 1 taka of vendor price times quantity', () => {
    const odd = { ...crate, vendorPrice: 3001, mrp: 3601 };
    [1, 7, 13, 29].forEach((quantity) => {
      const { item } = sell(odd, { quantity, unit: 'PIECE' });
      const [line] = bill([item]).ledgerLines;
      expect(Number.isInteger(line.vendorPayable)).toBe(true);
      expect(Math.abs(line.vendorPayable - (3001 / 360) * quantity)).toBeLessThanOrEqual(1);
    });
  });

  it('displayed lines add up exactly to the bill total', () => {
    const items = [
      sell(crate, { quantity: 7, unit: 'PIECE' }).item,
      { ...sell(crate, { quantity: 3, unit: 'EXTRA', unitName: 'Dozen' }).item, discount: { type: 'PERCENT', value: 7, reason: 'Promo' } },
      sell(sack, { quantity: 333, unit: 'PIECE' }).item,
    ];
    const result = calculateBill({
      items, paymentMethod: 'CASH', settings, billDiscount: { type: 'PERCENT', value: 3, reason: 'Promo' },
    });
    const sumOf = (key) => result.ledgerLines.reduce((sum, line) => sum + line[key], 0);
    expect(sumOf('itemDiscountAmount') + sumOf('billDiscountAmount')).toBe(result.otherDiscountAmount);
    expect(result.subtotal - result.otherDiscountAmount - result.shareholderDiscountAmount + result.vatAmount)
      .toBe(result.grandTotal);
    expect(result.ledgerLines.reduce((sum, line) => sum + line.subtotal, 0)).toBe(result.subtotal);
    [result.subtotal, result.grandTotal, result.otherDiscountAmount].forEach((value) => {
      expect(Number.isInteger(value)).toBe(true);
    });
  });

  it('rounds half up and rejects decimal quantities', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(129.75)).toBe(130);
    expect(() => bill([{ ownerType: 'COMPANY', quantity: 1.5, mrp: 10, vendorPrice: 5 }])).toThrow();
  });

  it('no decimal point appears in formatted money or quantity', () => {
    [0, 1, 129.75, 1206.5, 1234567.49].forEach((value) => {
      expect(formatMoney(value)).not.toMatch(/\./);
      expect(formatMoney(value, { symbol: '' })).not.toMatch(/\./);
    });
    expect(formatMoney(1206.5)).toBe('৳1,207');
    [0, 5, 331, 50000, 49500].forEach((quantity) => {
      expect(formatStock(quantity, crate)).not.toMatch(/\./);
      expect(formatStock(quantity, sack)).not.toMatch(/\./);
    });
  });
});
