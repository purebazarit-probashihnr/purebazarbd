const mongoose = require('mongoose');
const Product = require('../models/Product');
const ProductBarcodeCounter = require('../models/ProductBarcodeCounter');
const {
  barcodeFilter, barcodeLookupValues, barcodeMatches, ean13CheckDigit,
  findInternalBarcodeConflict, generateUniqueInternalBarcode, isInternalBarcodeProduct,
} = require('../utils/productBarcodes');
const { fifoStock, sortByFifo } = require('../services/posCatalogService');
const {
  findBarcodeConflicts, isOldGlobalBarcodeIndex, makeIndexPlan,
} = require('../scripts/migrateVendorProductBarcodes');

describe('vendor barcode behavior', () => {
  afterEach(() => jest.restoreAllMocks());

  it('allows the same code across vendors but identifies duplicates for the same vendor', () => {
    const products = [
      { _id: 'p1', ownerType: 'VENDOR', vendorId: 'v1', barcode: '4006381333931' },
      { _id: 'p2', ownerType: 'VENDOR', vendorId: 'v2', barcode: '4006381333931' },
    ];
    expect(findBarcodeConflicts(products)).toEqual([]);
    expect(findBarcodeConflicts([...products, {
      _id: 'p3', ownerType: 'VENDOR', vendorId: 'v1', barcode: '4006381333931',
    }])).toEqual([expect.objectContaining({ vendorId: 'v1', barcode: '4006381333931' })]);
  });

  it('indexes all identifiers uniquely within an owner and vendor scope', () => {
    const index = Product.schema.indexes().find(([, options]) => options.name === 'product_owner_vendor_barcode_unique');
    expect(index[0]).toEqual({ ownerType: 1, vendorId: 1, barcodeKeys: 1 });
    expect(index[1]).toMatchObject({ unique: true, partialFilterExpression: { barcodeKeys: { $exists: true } } });
  });

  it('generates a reserved internal barcode for an empty barcode field', async () => {
    jest.spyOn(ProductBarcodeCounter, 'findOneAndUpdate').mockResolvedValue({ sequence: 1 });
    jest.spyOn(Product, 'exists').mockResolvedValue(false);
    const product = new Product({
      name: 'Test item',
      categoryId: new mongoose.Types.ObjectId(),
      unitId: new mongoose.Types.ObjectId(),
      ownerType: 'COMPANY',
      vendorPrice: 1,
      mrp: 2,
      barcode: '',
    });
    await product.validate();
    expect(product.barcode).toMatch(/^29\d{11}$/);
    expect(product.barcode[12]).toBe(ean13CheckDigit(product.barcode.slice(0, 12)));
    expect(product.barcodeSource).toBe('internal');
  });

  it('allocates distinct valid EAN-13 codes for parallel product creations', async () => {
    let sequence = 0;
    const Counter = {
      findOneAndUpdate: jest.fn(async () => ({ sequence: ++sequence })),
    };
    const ProductModel = { exists: jest.fn().mockResolvedValue(false) };
    const barcodes = await Promise.all(Array.from({ length: 20 }, () => (
      generateUniqueInternalBarcode(ProductModel, Counter)
    )));

    expect(new Set(barcodes).size).toBe(20);
    barcodes.forEach((barcode) => {
      expect(barcode).toMatch(/^29\d{11}$/);
      expect(barcode[12]).toBe(ean13CheckDigit(barcode.slice(0, 12)));
    });
  });

  it('skips codes already present in primary, extra, or indexed barcodes', async () => {
    const occupiedBarcode = '2900000000018';
    const occupiedCompanyCode = '2900000000025';
    const occupiedKeysCode = '2900000000032';
    const Counter = {
      findOneAndUpdate: jest.fn()
        .mockResolvedValueOnce({ sequence: 1 })
        .mockResolvedValueOnce({ sequence: 2 })
        .mockResolvedValueOnce({ sequence: 3 })
        .mockResolvedValueOnce({ sequence: 4 }),
    };
    const records = [
      { ownerType: 'VENDOR', vendorId: 'vendor-1', barcodes: [occupiedBarcode] },
      { ownerType: 'COMPANY', barcode: occupiedCompanyCode },
      { ownerType: 'VENDOR', vendorId: 'vendor-2', barcodeKeys: [occupiedKeysCode] },
    ];
    const ProductModel = {
      exists: jest.fn(async (filter) => {
        const values = filter.$or[0].barcode.$in;
        return records.some((record) => values.some((value) => (
          record.barcode === value
          || (record.barcodes || []).includes(value)
          || (record.barcodeKeys || []).includes(value)
        )));
      }),
    };

    const generated = await generateUniqueInternalBarcode(ProductModel, Counter);

    expect(generated).toBe('2900000000049');
    expect(ProductModel.exists).toHaveBeenCalledTimes(4);
    expect(ProductModel.exists.mock.calls[0][0].$or).toEqual(expect.arrayContaining([
      { barcode: { $in: [occupiedBarcode] } },
      { barcodes: { $in: [occupiedBarcode] } },
      { barcodeKeys: { $in: [occupiedBarcode] } },
    ]));
  });

  it('treats UPC-A and its leading-zero EAN-13 form as the same code', async () => {
    const upc = '036000291452';
    const ean = '0036000291452';
    expect(barcodeLookupValues(upc)).toEqual([upc, ean]);
    expect(barcodeMatches({ barcode: ean, barcodes: [] }, upc)).toBe(true);
    expect(barcodeFilter(upc).$or).toEqual(expect.arrayContaining([
      { barcode: { $in: [upc, ean] } },
      { barcodes: { $in: [upc, ean] } },
      { barcodeKeys: { $in: [upc, ean] } },
    ]));
  });

  it('finds internal-code conflicts only across different product groups', async () => {
    const query = { select: jest.fn(() => query), lean: jest.fn() };
    const internalProduct = {
      _id: 'p2', name: 'Existing Rice', productGroupId: 'group-2',
      barcode: '2900000000018', barcodeSource: 'internal',
    };
    query.lean.mockResolvedValue([internalProduct]);
    const ProductModel = { find: jest.fn(() => query) };

    await expect(findInternalBarcodeConflict(ProductModel, internalProduct.barcode, {
      productGroupId: 'group-1',
    })).resolves.toBe(internalProduct);
    await expect(findInternalBarcodeConflict(ProductModel, internalProduct.barcode, {
      productGroupId: 'group-2',
    })).resolves.toBeNull();
  });

  it('matches an extra barcode to the product', () => {
    expect(barcodeMatches({ barcode: 'PB-ORIGINAL', barcodes: ['01234567'] }, '01234567')).toBe(true);
  });

  it('recognizes legacy PB codes as internal only when barcodeSource is missing', () => {
    expect(isInternalBarcodeProduct({ barcode: 'PB-LEGACY' })).toBe(true);
    expect(isInternalBarcodeProduct({ barcode: 'PB-TYPED', barcodeSource: 'manufacturer' })).toBe(false);
  });

  it('chooses the product with the oldest remaining GRN/transfer-in lot', () => {
    const oldestId = new mongoose.Types.ObjectId();
    const newerId = new mongoose.Types.ObjectId();
    const locationId = new mongoose.Types.ObjectId();
    const movements = [
      { productId: oldestId, quantity: 5, type: 'GRN', createdAt: new Date('2026-01-01') },
      { productId: oldestId, quantity: -4, type: 'SALE', createdAt: new Date('2026-01-02') },
      { productId: newerId, quantity: 5, type: 'TRANSFER_IN', createdAt: new Date('2026-01-03') },
    ];
    const stock = fifoStock(movements, [oldestId, newerId]);
    const sorted = sortByFifo([
      { _id: newerId, name: 'New vendor' },
      { _id: oldestId, name: 'Old vendor' },
    ], stock);

    expect(stock.get(oldestId.toString())).toMatchObject({ stock: 1, receivedAt: new Date('2026-01-01').getTime() });
    expect(sorted[0]._id).toEqual(oldestId);
    expect(stock.get(newerId.toString()).stock).toBe(5);
  });

  it('recognizes the legacy global barcode index for migration', () => {
    expect(isOldGlobalBarcodeIndex({ name: 'barcode_1', key: { barcode: 1 }, unique: true })).toBe(true);
    expect(isOldGlobalBarcodeIndex({ name: 'name_1', key: { name: 1 }, unique: true })).toBe(false);
  });

  it('plans migration without applying changes and reports legacy generated codes', () => {
    const plan = makeIndexPlan([
      { _id: 'p1', ownerType: 'COMPANY', barcode: '4006381333931' },
    ], [{ name: 'barcode_1', key: { barcode: 1 }, unique: true }]);
    expect(plan).toMatchObject({
      scanned: 1,
      oldIndexes: ['barcode_1'],
      legacyGeneratedCount: 1,
      backfillCount: 1,
      newIndex: {
        name: 'product_owner_vendor_barcode_unique',
        unique: true,
      },
    });
  });
});
