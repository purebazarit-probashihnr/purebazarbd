const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSalesHistoryParams,
  isWalletSale,
  paymentMethodLabel,
  sumMoney,
} = require('./pos-screen-utils.cjs');

describe('POS screen utilities', () => {
  it('omits empty filters while preserving selected sales history filters', () => {
    assert.deepEqual(buildSalesHistoryParams({
      from: '2026-10-01',
      to: '',
      paymentMethod: 'CASH',
      cashier: null,
    }), { from: '2026-10-01', paymentMethod: 'CASH' });
  });

  it('detects wallet sales and resolves payment labels', () => {
    assert.equal(isWalletSale({ payments: [{ method: 'WALLET' }] }), true);
    assert.equal(isWalletSale({ payments: [{ method: 'CASH' }] }), false);
    assert.equal(paymentMethodLabel('BKASH'), 'bKash');
  });

  it('sums whole-taka amounts rounded half up per line', () => {
    assert.equal(sumMoney([0.5, 1.5, 2.4]), 5);
  });
});
