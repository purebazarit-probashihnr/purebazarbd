const { linePricing, effectiveSubUnitPrice, toBaseQuantity } = require('../utils/piecePricing');
const { calculateBill } = require('../services/billEngine');

// Prices are per package; stock is in base units.
const rice = { unitsPerPackage: 25, vendorPrice: 2000, mrp: 2500 };
const soap = { unitsPerPackage: 120, vendorPrice: 600, mrp: 960 };
const eggs = { unitsPerPackage: 30, vendorPrice: 270, mrp: 330 };

describe('package and base unit conversion', () => {
  it('derives the price per base unit from the package price', () => {
    expect(effectiveSubUnitPrice(rice)).toBe(100);
    expect(effectiveSubUnitPrice(soap)).toBe(8);
    expect(effectiveSubUnitPrice(eggs)).toBe(11);
    expect(effectiveSubUnitPrice({ ...eggs, subUnitPriceOverride: 12 })).toBe(12);
  });

  it('selling 1 box then 5 pcs deducts 125 pcs from 15 boxes', () => {
    const box = linePricing(soap, { unit: 'PACKAGE', quantity: 1 });
    const pieces = linePricing(soap, { unit: 'PIECE', quantity: 5 });
    expect(box).toMatchObject({ unitPrice: 960, stockQuantity: 120 });
    expect(pieces).toMatchObject({ unitPrice: 8, stockQuantity: 5 });
    expect(15 * 120 - box.stockQuantity - pieces.stockQuantity).toBe(1675);
  });

  it('keeps fractional kg quantities exact', () => {
    expect(linePricing(rice, { unit: 'PIECE', quantity: 2.5 }).stockQuantity).toBe(2.5);
    expect(toBaseQuantity(rice, 'PACKAGE', 0.5)).toBe(12.5);
  });

  it('vendor payable matches the vendor price per base unit', () => {
    const pricing = linePricing(soap, { unit: 'PIECE', quantity: 5 });
    expect(pricing.unitVendorPrice).toBe(5);
    const bill = calculateBill({
      items: [{
        productId: 'p1', vendorId: 'v1', ownerType: 'VENDOR', quantity: 5,
        mrp: pricing.unitPrice, vendorPrice: pricing.unitVendorPrice,
      }],
      paymentMethod: 'CASH',
    });
    expect(bill.ledgerLines[0].vendorPayable).toBe(25);
    const boxPricing = linePricing(soap, { unit: 'PACKAGE', quantity: 1 });
    const boxBill = calculateBill({
      items: [{
        productId: 'p1', vendorId: 'v1', ownerType: 'VENDOR', quantity: 1,
        mrp: boxPricing.unitPrice, vendorPrice: boxPricing.unitVendorPrice,
      }],
      paymentMethod: 'CASH',
    });
    expect(boxBill.ledgerLines[0].vendorPayable).toBe(600);
  });

  it('cannot sell by base unit when the product has no conversion', () => {
    expect(linePricing({ mrp: 10, vendorPrice: 8 }, { unit: 'PIECE', quantity: 1 })).toBeNull();
  });
});