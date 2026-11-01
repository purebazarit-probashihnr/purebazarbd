const {
  calculateSubUnitPrice, effectiveSubUnitPrice, linePricing,
} = require('../utils/piecePricing');
const { calculateBill } = require('../services/billEngine');
const { Product } = require('../models');

describe('margin-safe piece pricing', () => {
  it('keeps the exact fractional price per base unit', () => {
    expect(calculateSubUnitPrice(1000, 30)).toBeCloseTo(33.3333333, 6);
    expect(calculateSubUnitPrice(100, 4)).toBe(25);
    expect(calculateSubUnitPrice(10, 3)).toBeCloseTo(3.3333333, 6);
    expect(calculateSubUnitPrice(100, 0)).toBeNull();
  });

  it('prefers a manager override over the automatic price', () => {
    const product = { mrp: 1000, unitsPerPackage: 30 };
    expect(effectiveSubUnitPrice(product)).toBeCloseTo(33.3333333, 6);
    expect(effectiveSubUnitPrice({ ...product, subUnitPriceOverride: 35 })).toBe(35);
    expect(effectiveSubUnitPrice({ mrp: 1000 })).toBeNull();
  });

  it('stores the piece price on the product and rejects overrides below it', async () => {
    const base = {
      name: 'Box', categoryId: '507f1f77bcf86cd799439011', unitId: '507f1f77bcf86cd799439012',
      ownerType: 'COMPANY', vendorPrice: 800, mrp: 1000, unitsPerPackage: 30,
    };
    const product = new Product(base);
    await product.validate();
    expect(product.subUnitPrice).toBeCloseTo(33.3333333, 6);
    const low = new Product({ ...base, subUnitPriceOverride: 33 });
    await expect(low.validate()).rejects.toThrow(/margin-safe/);
    const custom = new Product({ ...base, subUnitPriceOverride: 36 });
    await custom.validate();
    expect(custom.subUnitPrice).toBe(36);
  });

  it('selling all 30 pieces of a BDT 1000 box totals exactly BDT 1000 and deducts 30 base units', () => {
    const product = { mrp: 1000, vendorPrice: 800, unitsPerPackage: 30 };
    const pricing = linePricing(product, { unit: 'PIECE', quantity: 30 });
    expect(pricing.stockQuantity).toBe(30);
    const bill = calculateBill({
      items: [{
        productId: 'p1', ownerType: 'COMPANY', quantity: 30, mrp: pricing.unitPrice, vendorPrice: pricing.unitVendorPrice,
      }],
      paymentMethod: 'CASH',
    });
    expect(bill.subtotal).toBe(1000);
    expect(bill.grandTotal).toBe(1000);
  });
});
