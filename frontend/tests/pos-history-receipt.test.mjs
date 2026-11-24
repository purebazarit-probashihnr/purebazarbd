import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { buildHistoryReceipt } = require('../src/services/pos-history-receipt.cjs');

describe('Sales History receipt builder', () => {
  it('builds a receipt for older orders from stored values and createdAt', () => {
    const order = {
      orderNumber: 'POS-OLD',
      createdAt: '2024-01-02T03:04:05.000Z',
      lines: [{
        productName: 'Tea', barcode: 'PB-123', quantity: 1.5, unit: 'PACKAGE', packageUnitName: 'Box',
        mrp: 19.985, total: 19.985, itemDiscountAmount: 1.25, vatAmount: 0.75,
      }],
      subtotal: 19.985,
      otherDiscountAmount: 1.25,
      vatAmount: 0.75,
      grandTotal: 19.485,
      payments: [{ method: 'CASH', amount: 19.485 }],
    };

    const receipt = buildHistoryReceipt(order);
    assert.equal(receipt.soldAt, order.createdAt);
    assert.equal(receipt.lines[0].packageUnitName, 'Box');
    assert.equal(receipt.lines[0].barcode, 'PB-123');
    assert.equal(receipt.lines[0].mrp, 19.985);
    assert.equal(receipt.lines[0].total, 19.985);
    assert.equal(receipt.grandTotal, 19.485);
  });

  it('preserves the offline invoice number and hides legacy verification fields', () => {
    const receipt = buildHistoryReceipt({
      orderNumber: 'OFF-OUTLET-17',
      soldAt: '2026-11-22T09:00:00.000Z',
      lines: [],
      payments: [{ method: 'WALLET', amount: 100 }],
      walletOffline: true,
      walletVerification: 'pending',
    });

    assert.equal(receipt.orderNumber, 'OFF-OUTLET-17');
    assert.equal(receipt.walletOffline, true);
    assert.equal('walletVerification' in receipt, false);
  });

  it('preserves wallet tenders, stored discounts and VAT', () => {
    const receipt = buildHistoryReceipt({
      orderNumber: 'POS-WALLET',
      lines: [{
        itemDiscountAmount: 2, billDiscountAmount: 3, shareholderDiscountAmount: 5, vatAmount: 4,
      }],
      payments: [{ method: 'WALLET', amount: 94 }],
      otherDiscountAmount: 5,
      shareholderDiscountAmount: 5,
      vatAmount: 4,
      grandTotal: 94,
    });

    assert.deepEqual(receipt.payments, [{ method: 'WALLET', amount: 94 }]);
    assert.equal(receipt.lines[0].itemDiscountAmount, 2);
    assert.equal(receipt.lines[0].billDiscountAmount, 3);
    assert.equal(receipt.lines[0].shareholderDiscountAmount, 5);
    assert.equal(receipt.lines[0].vatAmount, 4);
  });

  it('marks every history receipt as a reprint', () => {
    assert.equal(buildHistoryReceipt({ orderNumber: 'POS-1' }).isReprint, true);
  });
});
