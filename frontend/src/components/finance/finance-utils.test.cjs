const test = require('node:test');
const assert = require('node:assert/strict');
const { sumWholeMoney } = require('./finance-utils.js');

test('sums payout amounts in whole taka, rounded half up per row', () => {
  assert.equal(sumWholeMoney([{ payable: 12.5 }, { payable: 0.4 }, { payable: 0.5 }], 'payable'), 14);
});
