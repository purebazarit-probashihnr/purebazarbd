jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  PriceHistory: { create: jest.fn() },
  Product: { create: jest.fn(), exists: jest.fn(), find: jest.fn(), findById: jest.fn() },
  Vendor: { findById: jest.fn() },
}));

const {
  AuditLog, PriceHistory, Product, Vendor,
} = require('../models');
const { createVendorCopy } = require('../services/vendorProductCopy');

describe('vendor product copy', () => {
  function productQuery(products = []) {
    const query = {
      select: jest.fn(() => query),
      lean: jest.fn().mockResolvedValue(products),
    };
    return query;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    Product.exists.mockResolvedValue(false);
    Product.find.mockReturnValue(productQuery());
  });

  it('copies product details and links the vendor copy to the existing group', async () => {
    const sourceId = '65b000000000000000000001';
    const vendorId = '65b000000000000000000002';
    const actorId = '65b000000000000000000003';
    const source = {
      _id: sourceId,
      name: 'Tea',
      sku: 'TEA-1',
      categoryId: '65b000000000000000000004',
      brandId: '65b000000000000000000005',
      unitId: '65b000000000000000000006',
      unitValue: 12,
      ownerType: 'VENDOR',
      vendorId: '65b000000000000000000007',
      vendorPrice: 75,
      mrp: 100,
      unitsPerPackage: 12,
      subUnitPriceOverride: 8,
      vatApplicable: true,
      vatRate: 5,
      barcode: 'PB-ORIGINAL',
      barcodes: ['01234567'],
      barcodeSource: 'internal',
      listedOnline: false,
      save: jest.fn(),
    };
    const vendor = { _id: vendorId, name: 'New vendor', shopName: 'New shop' };
    const copyId = '65b000000000000000000008';
    Product.findById.mockResolvedValue(source);
    Product.exists.mockResolvedValue(false);
    Product.create.mockImplementation(async (input) => ({ ...source, ...input, _id: copyId }));
    Vendor.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(vendor) });
    PriceHistory.create.mockResolvedValue({});
    AuditLog.create.mockResolvedValue({});

    await createVendorCopy({
      sourceProductId: sourceId,
      vendorId,
      vendorPrice: 80,
      mrp: 105,
      actorId,
      ipAddress: '127.0.0.1',
    });

    expect(source.productGroupId).toBe(sourceId);
    expect(source.save).toHaveBeenCalled();
    expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Tea',
      categoryId: source.categoryId,
      brandId: source.brandId,
      unitId: source.unitId,
      unitValue: 12,
      unitsPerPackage: 12,
      subUnitPriceOverride: 8,
      vatApplicable: true,
      vatRate: 5,
      barcode: 'PB-ORIGINAL',
      barcodes: ['01234567'],
      barcodeSource: 'internal',
      productGroupId: sourceId,
      ownerType: 'VENDOR',
      vendorId,
      vendorPrice: 80,
      mrp: 105,
    }));
    expect(PriceHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      productId: copyId,
      oldVendorPrice: 75,
      newVendorPrice: 80,
      oldMrp: 100,
      newMrp: 105,
      changedBy: actorId,
    }));
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      entity: 'Product',
      entityId: copyId,
      metadata: { copiedFrom: sourceId },
    }));
  });

  it('refuses a second copy with the same barcode for one vendor', async () => {
    const source = {
      _id: '65b000000000000000000011',
      name: 'Tea',
      ownerType: 'VENDOR',
      vendorId: '65b000000000000000000012',
      barcode: 'PB-TEA',
      barcodes: [],
    };
    const vendor = { _id: '65b000000000000000000013' };
    Product.findById.mockResolvedValue(source);
    Product.exists.mockResolvedValue(true);
    Vendor.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(vendor) });

    await expect(createVendorCopy({
      sourceProductId: source._id,
      vendorId: vendor._id,
      vendorPrice: 70,
      mrp: 100,
      actorId: 'actor',
    })).rejects.toMatchObject({ status: 409 });
    expect(Product.create).not.toHaveBeenCalled();
  });

  it('refuses to copy an internal code into a different product group', async () => {
    const source = {
      _id: '65b000000000000000000021',
      name: 'Tea',
      ownerType: 'VENDOR',
      vendorId: '65b000000000000000000022',
      productGroupId: '65b000000000000000000023',
      barcode: 'PB-TEA',
      barcodes: [],
      barcodeSource: 'internal',
    };
    const vendor = { _id: '65b000000000000000000024' };
    Product.findById.mockResolvedValue(source);
    Product.find.mockReturnValue(productQuery([{
      _id: '65b000000000000000000025',
      name: 'Other Tea',
      productGroupId: '65b000000000000000000026',
      barcode: 'PB-TEA',
      barcodeSource: 'internal',
    }]));
    Vendor.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(vendor) });

    await expect(createVendorCopy({
      sourceProductId: source._id,
      vendorId: vendor._id,
      vendorPrice: 70,
      mrp: 100,
      actorId: 'actor',
    })).rejects.toMatchObject({
      status: 409,
      message: 'This code is already the in-store code of Other Tea',
    });
    expect(Product.create).not.toHaveBeenCalled();
  });
});
