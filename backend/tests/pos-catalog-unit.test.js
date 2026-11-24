const mongoose = require('mongoose');

const productId = new mongoose.Types.ObjectId();
const unitId = new mongoose.Types.ObjectId();
const categoryId = new mongoose.Types.ObjectId();
const vendorId = new mongoose.Types.ObjectId();
const outletId = new mongoose.Types.ObjectId();
jest.mock('../models', () => ({
  Category: { find: jest.fn() },
  Location: { findById: jest.fn() },
  Product: { findOne: jest.fn(), find: jest.fn() },
  Settings: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
  StockMovement: { aggregate: jest.fn(), find: jest.fn() },
  Unit: { find: jest.fn() },
  Vendor: { find: jest.fn() },
}));
jest.mock('../services/posBillService', () => ({ statusError: (m, s) => Object.assign(new Error(m), { status: s }) }));

const models = require('../models');
const { getCatalog, searchItems } = require('../services/posCatalogService');

describe('POS catalog base unit', () => {
  it('returns the product base unit name as packageUnitName with its piece ratio', async () => {
    const eggs = {
      _id: productId, name: 'Egg', unitId, mrp: 120, unitValue: 10, vendorPrice: 100, unitsPerPackage: 12,
    };
    models.Product.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [eggs] }) }) });
    models.StockMovement.find.mockReturnValue({
      select: () => ({ sort: () => ({ lean: async () => [] }) }),
    });
    models.Unit.find.mockReturnValue({ select: () => ({ lean: async () => [{ _id: unitId, name: 'Doz', abbreviation: 'Doz' }] }) });
    const res = { json: jest.fn() };
    await searchItems({ query: { q: 'egg' }, user: {}, locationId: new mongoose.Types.ObjectId() }, res, jest.fn());

    const item = res.json.mock.calls[0][0].items[0];
    expect(item.packageUnitName).toBe('Doz');
    expect(item.unitsPerPackage).toBe(12);
    expect(item.unitValue).toBe(10);
  });

  it('returns an outlet catalog snapshot with pricing, barcodes, vendor, stock, and a reserved sequence', async () => {
    const eggs = {
      _id: productId,
      categoryId,
      unitId,
      name: 'Egg',
      barcode: 'PB-1001',
      barcodes: ['EGG-01'],
      ownerType: 'VENDOR',
      vendorId,
      vendorPrice: 100,
      mrp: 120,
      unitValue: 10,
      unitsPerPackage: 12,
      vatApplicable: true,
    };
    const outlet = { _id: outletId, name: 'Outlet One' };
    models.Product.find.mockReturnValue({ sort: () => ({ lean: async () => [eggs] }) });
    models.Settings.findOne.mockReturnValue({ lean: async () => ({
      vatEnabled: true, defaultVatRate: 7.5, discountLimitByRole: { Cashier: 5 },
    }) });
    models.Settings.findOneAndUpdate.mockResolvedValue({
      offlineNumberCounters: new Map([[outletId.toString(), 1000]]),
    });
    models.Location.findById.mockReturnValue({ lean: async () => outlet });
    models.StockMovement.find.mockReturnValue({
      select: () => ({ sort: () => ({ lean: async () => [{
        productId, quantity: 8, type: 'GRN', createdAt: new Date('2026-01-01'),
      }] }) }),
    });
    models.Unit.find.mockReturnValue({ select: () => ({ lean: async () => [
      { _id: unitId, name: 'Dozen', abbreviation: 'Dz' },
    ] }) });
    models.Vendor.find.mockReturnValue({ select: () => ({ lean: async () => [
      { _id: vendorId, name: 'Vendor One' },
    ] }) });
    models.Category.find.mockReturnValue({ select: () => ({ lean: async () => [
      { _id: categoryId, vatRate: 10 },
    ] }) });
    const res = { json: jest.fn() };
    await getCatalog({ locationId: outletId }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      outlet: { id: outletId.toString(), name: 'Outlet One', code: outletId.toString().toUpperCase() },
      offlineNumberRange: { start: 1, end: 1000 },
      settings: expect.objectContaining({ vatEnabled: true, discountLimitByRole: { Cashier: 5 } }),
      items: [expect.objectContaining({
        productId,
        barcode: 'PB-1001',
        barcodes: ['EGG-01'],
        mrp: 120,
        vendorName: 'Vendor One',
        stock: 8,
        categoryVatRate: 10,
      })],
    }));
    expect(models.Settings.findOneAndUpdate).toHaveBeenCalledWith(
      { singleton: 'global' },
      { $inc: { [`offlineNumberCounters.${outletId}`]: 1000 } },
      expect.objectContaining({ new: true, upsert: true }),
    );
  });
});
