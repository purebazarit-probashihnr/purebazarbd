const mongoose = require('mongoose');

jest.mock('../models', () => ({
  Product: { find: jest.fn() },
  StockMovement: { find: jest.fn() },
  Vendor: { find: jest.fn() },
  Unit: { find: jest.fn() },
}));

const {
  Product, StockMovement, Vendor,
} = require('../models');
const { scanItem } = require('../services/posCatalogService');

function query(value) {
  const chain = {
    select: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    lean: jest.fn(async () => value),
  };
  return chain;
}

describe('POS product barcode resolution', () => {
  beforeEach(() => jest.clearAllMocks());

  it('resolves duplicate barcodes to the vendor copy with the oldest positive stock lot', async () => {
    const oldProductId = new mongoose.Types.ObjectId();
    const newProductId = new mongoose.Types.ObjectId();
    const oldVendorId = new mongoose.Types.ObjectId();
    const newVendorId = new mongoose.Types.ObjectId();
    const locationId = new mongoose.Types.ObjectId();
    const products = [
      { _id: newProductId, name: 'Tea', barcode: '4006381333931', ownerType: 'VENDOR', vendorId: newVendorId, mrp: 100, vendorPrice: 70 },
      { _id: oldProductId, name: 'Tea', barcode: '4006381333931', ownerType: 'VENDOR', vendorId: oldVendorId, mrp: 100, vendorPrice: 65 },
    ];
    Product.find.mockImplementation(() => ({
      sort: jest.fn(() => ({ lean: jest.fn(async () => products) })),
    }));
    StockMovement.find.mockReturnValue(query([
      { productId: oldProductId, quantity: 3, type: 'GRN', createdAt: new Date('2026-01-01') },
      { productId: newProductId, quantity: 4, type: 'TRANSFER_IN', createdAt: new Date('2026-02-01') },
    ]));
    Vendor.find.mockReturnValue(query([
      { _id: oldVendorId, name: 'Old vendor' },
      { _id: newVendorId, name: 'New vendor' },
    ]));

    const response = { json: jest.fn() };
    const next = jest.fn();
    await scanItem({ params: { barcode: '4006381333931' }, locationId }, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(Product.find).toHaveBeenCalledWith({
      $or: [{ barcode: '4006381333931' }, { barcodes: '4006381333931' }],
    });
    expect(response.json.mock.calls[0][0].item).toMatchObject({
      productId: oldProductId,
      vendorName: 'Old vendor',
      stock: 3,
      vendorMatches: [
        expect.objectContaining({ productId: oldProductId, stock: 3 }),
        expect.objectContaining({ productId: newProductId, stock: 4 }),
      ],
    });
  });

  it('finds a product by an extra barcode', async () => {
    const productId = new mongoose.Types.ObjectId();
    const product = {
      _id: productId,
      name: 'Tea',
      barcode: 'PB-TEA',
      barcodes: ['BOX-TEA'],
      ownerType: 'COMPANY',
      mrp: 100,
      vendorPrice: 80,
    };
    Product.find.mockImplementation((filter) => ({
      sort: jest.fn(() => ({
        lean: jest.fn(async () => (filter.$or.some((condition) => condition.barcodes === 'BOX-TEA') ? [product] : [])),
      })),
    }));
    StockMovement.find.mockReturnValue(query([
      { productId, quantity: 2, type: 'GRN', createdAt: new Date('2026-01-01') },
    ]));

    const response = { json: jest.fn() };
    await scanItem({
      params: { barcode: 'BOX-TEA' },
      locationId: new mongoose.Types.ObjectId(),
    }, response, jest.fn());

    expect(response.json.mock.calls[0][0].item.productId).toEqual(productId);
  });
});
