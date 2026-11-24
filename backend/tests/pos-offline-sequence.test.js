jest.mock('../models', () => ({
  Settings: { findOneAndUpdate: jest.fn() },
}));

const { Settings } = require('../models');
const { reserveOfflineNumberBlock } = require('../services/posCatalogService');

describe('POS offline number reservations', () => {
  it('reserves non-overlapping sequence ranges for the same outlet', async () => {
    const outletId = '65b000000000000000000003';
    let counter = 0;
    Settings.findOneAndUpdate.mockImplementation(async () => {
      counter += 1000;
      return { offlineNumberCounters: new Map([[outletId, counter]]) };
    });

    const first = await reserveOfflineNumberBlock(outletId);
    const second = await reserveOfflineNumberBlock(outletId);

    expect(first).toEqual({ start: 1, end: 1000 });
    expect(second).toEqual({ start: 1001, end: 2000 });
    expect(first.end).toBeLessThan(second.start);
  });
});
