const { VendorCodeCounter } = require('../models');

async function nextVendorCode() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const counter = await VendorCodeCounter.findOneAndUpdate(
        { _id: 'vendor' },
        { $inc: { sequence: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      if (!counter || !Number.isInteger(counter.sequence) || counter.sequence < 1) {
        throw new Error('Unable to allocate a vendor code');
      }
      return `VND-${String(counter.sequence).padStart(4, '0')}`;
    } catch (error) {
      if (error.code !== 11000 || attempt === 1) throw error;
    }
  }
  throw new Error('Unable to allocate a vendor code');
}

module.exports = { nextVendorCode };
