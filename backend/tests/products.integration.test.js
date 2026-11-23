const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');

jest.mock('../models', () => ({
  AuditLog: { create: jest.fn() },
  Brand: { exists: jest.fn() },
  Category: { exists: jest.fn() },
  PriceHistory: { create: jest.fn() },
  ProductBarcodeCounter: { findOneAndUpdate: jest.fn() },
  Product: { create: jest.fn(), exists: jest.fn(), find: jest.fn(), findById: jest.fn() },
  Settings: { findOne: jest.fn() },
  Unit: { exists: jest.fn(), find: jest.fn() },
  User: { findById: jest.fn() },
  Vendor: { exists: jest.fn(), find: jest.fn(), findById: jest.fn() },
}));

const {
  AuditLog, Brand, Category, PriceHistory, Product, ProductBarcodeCounter, Settings, Unit, User, Vendor,
} = require('../models');
const productRoutes = require('../routes/productRoutes');
const errorMiddleware = require('../middlewares/errorMiddleware');

const secret = 'products-integration-test-secret';
const adminId = '65b000000000000000000001';
const productId = '65b000000000000000000002';
const categoryId = '65b000000000000000000003';
const unitId = '65b000000000000000000004';
const admin = {
  _id: { toString: () => adminId },
  isActive: true,
  roleId: { name: 'Inventory Manager', permissions: ['products:read', 'products:write'] },
};
const product = {
  _id: productId,
  name: 'Rice',
  categoryId,
  unitId,
  ownerType: 'COMPANY',
  vendorPrice: 95,
  mrp: 100,
  margin: 5,
  vatApplicable: true,
  vatRate: 5,
  barcode: 'PB0123456789ABCDEF012345',
  createdAt: new Date('2026-10-01'),
  updatedAt: new Date('2026-10-01'),
};

function chain(value) {
  const result = {
    select: jest.fn(() => result),
    sort: jest.fn(() => result),
    lean: jest.fn(() => Promise.resolve(value)),
  };
  return result;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/products', productRoutes);
  app.use(errorMiddleware);
  return app;
}

function token() {
  return jwt.sign({ sub: adminId }, secret, { expiresIn: '1h' });
}

describe('product endpoints', () => {
  const app = createApp();
  const auth = { Authorization: `Bearer ${token()}` };

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
    jest.clearAllMocks();
    User.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(admin) });
    Settings.findOne.mockReturnValue(chain({ shareholderDiscountPercent: 5 }));
    Category.exists.mockResolvedValue(true);
    Brand.exists.mockResolvedValue(true);
    Unit.exists.mockResolvedValue(true);
    Vendor.exists.mockResolvedValue(true);
    Product.exists.mockResolvedValue(false);
    ProductBarcodeCounter.findOneAndUpdate.mockResolvedValue({ sequence: 1 });
    Vendor.find.mockReturnValue(chain([]));
    AuditLog.create.mockResolvedValue({});
    PriceHistory.create.mockResolvedValue({});
    Product.find.mockImplementation((filter) => chain(filter ? [] : [product]));
    Unit.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ _id: unitId, name: 'Box', abbreviation: 'Box' }]) }) });
  });

  it('adds the unit to the display name without changing the stored name', async () => {
    const response = await request(app).get('/api/products').set(auth);

    expect(response.body.products[0]).toMatchObject({ name: 'Rice', unitLabel: 'Box', displayName: 'Rice [Box]' });
  });

  it('lists products with calculated margin warning and VAT data', async () => {
    Product.find.mockReturnValue(chain([{ ...product, vendorPrice: 96, margin: 4 }]));
    const response = await request(app).get('/api/products').set(auth);

    expect(response.status).toBe(200);
    expect(response.body.marginWarningPercent).toBe(5);
    expect(response.body.products[0]).toMatchObject({
      ownerType: 'COMPANY',
      vendorPrice: 96,
      mrp: 100,
      margin: 4,
      marginWarning: true,
      vatApplicable: true,
      vatRate: 5,
      barcode: product.barcode,
    });
  });

  it('rejects MRP below vendor price and creates products with generated barcode', async () => {
    const invalid = await request(app).post('/api/products').set(auth).send({
      name: 'Rice', categoryId, unitId, ownerType: 'COMPANY', vendorPrice: 101, mrp: 100,
    });
    Product.create.mockImplementation(async (input) => ({
      ...product, ...input, margin: input.mrp - input.vendorPrice,
    }));
    const created = await request(app).post('/api/products').set(auth).send({
      name: 'Rice', categoryId, unitId, ownerType: 'COMPANY', vendorPrice: 95, mrp: 100,
      sku: 'RICE-001', vatApplicable: true, vatRate: 5,
    });

    expect(invalid.status).toBe(400);
    expect(Product.create).toHaveBeenCalledTimes(1);
    expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'COMPANY', vendorPrice: 95, mrp: 100, sku: 'RICE-001', vatApplicable: true, vatRate: 5,
      barcode: expect.stringMatching(/^29\d{11}$/), barcodeSource: 'internal',
    }));
    expect(created.status).toBe(201);
    expect(created.body.product.barcode).toMatch(/^29\d{11}$/);
    expect(created.body.product.sku).toBe('RICE-001');
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE', entity: 'Product',
    }));
  });

  it('blocks a manually entered internal code belonging to another product group', async () => {
    const internalProduct = {
      _id: '65b000000000000000000010',
      name: 'Existing Rice',
      barcode: '2900000000013',
      barcodeSource: 'internal',
      productGroupId: '65b000000000000000000011',
    };
    Product.find.mockReturnValueOnce(chain([internalProduct]));
    const response = await request(app).post('/api/products').set(auth).send({
      name: 'Rice copy', categoryId, unitId, ownerType: 'COMPANY', vendorPrice: 95, mrp: 100,
      barcode: internalProduct.barcode, barcodeSource: 'internal',
    });

    expect(response.status).toBe(409);
    expect(response.body.message).toBe('This code is already the in-store code of Existing Rice');
    expect(Product.create).not.toHaveBeenCalled();
  });

  it('stores manually entered codes starting with 29 as manufacturer codes', async () => {
    Product.create.mockImplementation(async (input) => ({ ...product, ...input }));
    const response = await request(app).post('/api/products').set(auth).send({
      name: 'Manual item', categoryId, unitId, ownerType: 'COMPANY', vendorPrice: 95, mrp: 100,
      barcode: '2901234567890', barcodeSource: 'internal',
    });

    expect(response.status).toBe(201);
    expect(Product.create).toHaveBeenCalledWith(expect.objectContaining({
      barcode: '2901234567890',
      barcodeSource: 'manufacturer',
    }));
  });

  it('blocks an internal-code collision when updating extra barcodes', async () => {
    const current = {
      ...product,
      productGroupId: productId,
      barcodes: [],
      set: jest.fn(),
      save: jest.fn(),
    };
    Product.findById.mockReturnValue(current);
    Product.find.mockReturnValueOnce(chain([{
      _id: '65b000000000000000000010',
      name: 'Existing Rice',
      barcode: '2900000000013',
      barcodeSource: 'internal',
      productGroupId: '65b000000000000000000011',
    }]));
    const response = await request(app).put(`/api/products/${productId}`).set(auth)
      .send({ barcodes: ['2900000000013'] });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/in-store code of Existing Rice/);
    expect(current.set).not.toHaveBeenCalled();
  });

  it('keeps manufacturer matches available to the vendor-copy flow', async () => {
    const manufacturerProduct = {
      ...product,
      barcode: '4006381333931',
      barcodeSource: 'manufacturer',
      productGroupId: productId,
      vendorId: '65b000000000000000000010',
    };
    Product.find.mockReturnValueOnce(chain([manufacturerProduct]));
    const response = await request(app).get('/api/products/barcodes/4006381333931').set(auth);

    expect(response.status).toBe(200);
    expect(response.body.products[0]).toMatchObject({
      name: 'Rice',
      barcodeSource: 'manufacturer',
      productGroupId: productId,
    });
  });

  it('ignores unitValue when creating a product', async () => {
    Product.create.mockImplementation(async (input) => ({ ...product, ...input, barcode: 'PB1' }));
    const res = await request(app).post('/api/products').set(auth).send({
      name: 'Sugar', categoryId, unitId, unitValue: 1500, ownerType: 'COMPANY', vendorPrice: 90, mrp: 100,
    });

    expect(res.status).toBe(201);
    expect(Product.create.mock.calls[0][0]).not.toHaveProperty('unitValue');
    expect(Product.create.mock.calls[0][0]).toMatchObject({ unitId });
  });

  it('records price history and an audit event when an authorized user changes prices', async () => {
    const current = {
      ...product,
      set: jest.fn(function set(values) { Object.assign(this, values); }),
      save: jest.fn(async function save() {
        this.margin = Math.round((this.mrp - this.vendorPrice + Number.EPSILON) * 100) / 100;
      }),
    };
    Product.findById.mockReturnValue(current);
    const response = await request(app).put(`/api/products/${productId}`).set(auth).send({
      vendorPrice: 90, mrp: 110, reason: 'Supplier cost update',
    });

    expect(response.status).toBe(200);
    expect(response.body.product).toMatchObject({ vendorPrice: 90, mrp: 110, margin: 20, marginWarning: false });
    expect(PriceHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      productId: productId,
      oldVendorPrice: 95,
      newVendorPrice: 90,
      oldMrp: 100,
      newMrp: 110,
      changedBy: admin._id,
      reason: 'Supplier cost update',
    }));
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', entity: 'Product', metadata: { priceChanged: true },
    }));
  });

  it('creates a vendor copy with shared identifiers and records price history and audit', async () => {
    const newVendorId = '65b000000000000000000009';
    const source = {
      ...product,
      productGroupId: productId,
      unitsPerPackage: 12,
      barcode: 'PB-TEA',
      barcodes: ['01234567'],
      barcodeSource: 'internal',
      vatApplicable: true,
      vatRate: 5,
      save: jest.fn(),
    };
    const vendor = { _id: newVendorId, name: 'New vendor', shopName: 'New shop' };
    Product.findById.mockResolvedValue(source);
    Product.exists.mockResolvedValue(false);
    Vendor.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(vendor) });
    Vendor.find.mockReturnValue(chain([vendor]));
    Product.create.mockImplementation(async (input) => ({
      ...source,
      ...input,
      _id: '65b00000000000000000000a',
      margin: input.mrp - input.vendorPrice,
    }));

    const response = await request(app).post(`/api/products/${productId}/add-vendor`).set(auth).send({
      vendorId: newVendorId, vendorPrice: 80, mrp: 110,
    });

    expect(response.status).toBe(201);
    expect(response.body.product).toMatchObject({
      productGroupId: productId,
      vendorId: newVendorId,
      vendorName: 'New shop',
      barcode: 'PB-TEA',
      barcodes: ['01234567'],
      barcodeSource: 'internal',
      unitsPerPackage: 12,
      vatApplicable: true,
      vatRate: 5,
      vendorPrice: 80,
      mrp: 110,
    });
    expect(PriceHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      oldVendorPrice: product.vendorPrice,
      newVendorPrice: 80,
    }));
    expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CREATE',
      entity: 'Product',
      metadata: { copiedFrom: productId },
    }));
  });

  it('rejects attempts to set stock quantity through product updates', async () => {
    const response = await request(app).put(`/api/products/${productId}`).set(auth)
      .send({ stockQuantity: 500 });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringMatching(/stock quantities cannot be changed/i) }),
    ]));
    expect(Product.findById).not.toHaveBeenCalled();
  });

  it('rejects vendor-price changes that would leave MRP below vendor price', async () => {
    const current = {
      ...product,
      set: jest.fn(),
      save: jest.fn(),
    };
    Product.findById.mockReturnValue(current);

    const response = await request(app).put(`/api/products/${productId}`).set(auth)
      .send({ vendorPrice: 101 });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/MRP must be greater than or equal to vendor price/i);
    expect(current.set).not.toHaveBeenCalled();
    expect(current.save).not.toHaveBeenCalled();
    expect(PriceHistory.create).not.toHaveBeenCalled();
  });

  it('denies cashiers permission to change prices', async () => {
    User.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue({
      ...admin, roleId: { name: 'Outlet Cashier', permissions: ['pos:write'] },
    }) });
    const response = await request(app).put(`/api/products/${productId}`).set(auth)
      .send({ mrp: 110 });

    expect(response.status).toBe(403);
    expect(Product.findById).not.toHaveBeenCalled();
    expect(PriceHistory.create).not.toHaveBeenCalled();
    expect(AuditLog.create).not.toHaveBeenCalled();
  });
});
