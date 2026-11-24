const mongoose = require('mongoose');
const models = require('../models');
const { ean13CheckDigit } = require('../utils/productBarcodes');

const objectId = () => new mongoose.Types.ObjectId();

describe('Mongoose models', () => {
  let sequence;

  beforeEach(() => {
    sequence = 0;
    jest.spyOn(models.ProductBarcodeCounter, 'findOneAndUpdate')
      .mockImplementation(async () => ({ sequence: ++sequence }));
    jest.spyOn(models.Product, 'exists').mockResolvedValue(false);
  });

  afterEach(() => jest.restoreAllMocks());

  it('registers every requested model', () => {
    expect(Object.keys(models).sort()).toEqual([
      'AttendanceRecord', 'AuditLog', 'Brand', 'Category', 'DiscountLog', 'Employee', 'Expense', 'ExpenseCategory',
      'GoodsReceive', 'Location', 'Order', 'PriceHistory', 'Product', 'ProductBarcodeCounter', 'Return', 'Role', 'RosterEntry', 'SalaryAdvance',
      'SalarySheet', 'Settings', 'Shareholder', 'Shift', 'StockAdjustment', 'StockCount',
      'StockMovement', 'StockTransfer', 'Unit', 'User', 'Vendor', 'VendorCodeCounter', 'VendorLedger',
      'VendorRegistration', 'VendorStatement', 'WalletAuditLog', 'WalletLog', 'WalletReconciliation', 'WorkShift',
    ]);
  });

  it('rejects an MRP below vendor price', async () => {
    const product = new models.Product({
      name: 'Rice',
      categoryId: objectId(),
      unitId: objectId(),
      ownerType: 'COMPANY',
      vendorPrice: 100,
      mrp: 99,
    });

    await expect(product.validate()).rejects.toMatchObject({
      errors: { mrp: expect.objectContaining({ message: expect.stringContaining('greater than or equal') }) },
    });
  });

  it('calculates margin and applies stock and commission defaults', async () => {
    const product = new models.Product({
      name: 'Rice',
      sku: ' RICE-001 ',
      categoryId: objectId(),
      unitId: objectId(),
      ownerType: 'COMPANY',
      vendorPrice: 99.99,
      mrp: 120,
    });
    const category = new models.Category({ name: 'Food' });

    await product.validate();
    await category.validate();

    expect(product.margin).toBe(20.01);
    expect(product.sku).toBe('RICE-001');
    expect(product.listedOnline).toBe(false);
    expect(category.commissionEnabled).toBe(false);
  });

  it('generates an internal barcode and declares uniqueness per vendor', async () => {
    const product = new models.Product({
      name: 'Rice',
      categoryId: objectId(),
      unitId: objectId(),
      ownerType: 'COMPANY',
      vendorPrice: 99,
      mrp: 120,
    });

    await product.validate();

    expect(product.barcode).toMatch(/^29\d{11}$/);
    expect(product.barcode[12]).toBe(ean13CheckDigit(product.barcode.slice(0, 12)));
    expect(product.barcodeSource).toBe('internal');
    expect(product.productGroupId).toEqual(product._id);
    expect(models.Product.schema.indexes().some(([fields, options]) => (
      fields.ownerType === 1
      && fields.vendorId === 1
      && fields.barcodeKeys === 1
      && options.unique
    ))).toBe(true);
  });

  it('allows manufacturer barcodes with invalid check digits for warning-only UI validation', async () => {
    const product = new models.Product({
      name: 'Rice',
      categoryId: objectId(),
      unitId: objectId(),
      ownerType: 'COMPANY',
      vendorPrice: 99,
      mrp: 120,
      barcode: '4006381333932',
    });

    await expect(product.validate()).resolves.toBeUndefined();
    expect(product.barcodeSource).toBe('manufacturer');
  });

  it('requires a reason for stock adjustments', async () => {
    const adjustment = new models.StockAdjustment({
      warehouseId: objectId(),
      createdBy: objectId(),
      lines: [{ productId: objectId(), quantity: 1 }],
    });

    await expect(adjustment.validate()).rejects.toMatchObject({
      errors: { reason: expect.objectContaining({ kind: 'required' }) },
    });
  });

  it('requires signed nonzero movement quantities and unique products per GRN', async () => {
    const outgoing = new models.StockMovement({
      productId: objectId(), warehouseId: objectId(), quantity: 2, type: 'SALE', userId: objectId(),
    });
    const grn = new models.GoodsReceive({
      ownerType: 'COMPANY',
      warehouseId: objectId(),
      createdBy: objectId(),
      lines: [
        { productId: objectId(), receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 },
        { productId: objectId(), receivedQuantity: 1, acceptedQuantity: 1, rejectedQuantity: 0 },
      ],
    });
    grn.lines[1].productId = grn.lines[0].productId;

    await expect(outgoing.validate()).rejects.toMatchObject({
      errors: { quantity: expect.objectContaining({ message: 'Outgoing movements must have a negative quantity' }) },
    });
    await expect(grn.validate()).rejects.toMatchObject({
      errors: { lines: expect.objectContaining({ message: 'A product can only appear once on a goods receive' }) },
    });
  });

  it('restricts locations to central warehouses or outlets and requires a name', async () => {
    const central = new models.Location({ type: 'CENTRAL', name: 'Central Warehouse' });
    const outlet = new models.Location({ type: 'OUTLET', name: 'Demo Outlet' });
    const invalid = new models.Location({ type: 'WAREHOUSE', name: '' });

    await expect(central.validate()).resolves.toBeUndefined();
    await expect(outlet.validate()).resolves.toBeUndefined();
    expect(outlet.isActive).toBe(true);
    expect(outlet.isPrimary).toBe(false);
    await expect(invalid.validate()).rejects.toMatchObject({
      errors: {
        type: expect.objectContaining({ kind: 'enum' }),
        name: expect.objectContaining({ kind: 'required' }),
      },
    });
  });

  it('ensures the default central warehouse through an idempotent upsert', async () => {
    const findOneAndUpdate = jest.spyOn(models.Location, 'findOneAndUpdate')
      .mockResolvedValue({ type: 'CENTRAL', name: 'Central Warehouse' });

    await models.Location.ensureCentralWarehouse();

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { type: 'CENTRAL', name: 'Central Warehouse' },
      { $setOnInsert: { type: 'CENTRAL', name: 'Central Warehouse' } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    findOneAndUpdate.mockRestore();
  });

  it('declares requested product lookup indexes', () => {
    const indexes = models.Product.schema.indexes().map(([fields]) => fields);

    expect(indexes).toContainEqual({ ownerType: 1, vendorId: 1, barcodeKeys: 1 });
    expect(indexes).toContainEqual({ vendorId: 1 });
    expect(indexes).toContainEqual({ createdAt: 1 });
    expect(models.Product.schema.path('sku')).toBeDefined();
    expect(indexes.some((fields) => fields.sku)).toBe(false);
  });
});