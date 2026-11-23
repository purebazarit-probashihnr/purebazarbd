import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const {
  calculateOfflineBill, offlineWalletError,
} = require('../src/services/pos-offline-engine.cjs');
const { offlineSessionIsValid } = require('../src/services/offline-session-utils.cjs');

describe('offline POS billing and session', () => {
  it('uses the shared bill engine for local non-wallet totals', () => {
    const bill = calculateOfflineBill([{
      productId: 'product-1',
      name: 'Tea',
      ownerType: 'VENDOR',
      vendorId: 'vendor-1',
      vendorPrice: 55,
      mrp: 100,
      quantity: 2,
      unit: 'PACKAGE',
      vatApplicable: false,
    }], null, ['CASH'], {
      role: 'Cashier',
      vatEnabled: false,
      defaultVatRate: 0,
      shareholderDiscountPercent: 5,
      discountLimitByRole: { Cashier: 5 },
    });

    assert.equal(bill.grandTotal, 200);
    assert.equal(bill.ledgerLines[0].vendorPayable, 110);
    assert.equal(bill.discountApprovalRequired, false);
  });

  it('blocks wallet sales from the offline bill engine', () => {
    assert.throws(() => calculateOfflineBill([], null, ['WALLET'], {
      allowWalletPaymentOffline: false,
    }), /internet connection/);
  });

  it('refuses offline wallet bills over the configured maximum', () => {
    const settings = {
      allowWalletPaymentOffline: true,
      maximumOfflineWalletAmountPerBill: 2000,
    };
    assert.match(offlineWalletError(settings, 2000.01), /limited to ৳2000.00/);
  });

  it('allows offline wallet bills without member identifiers', () => {
    const settings = {
      allowWalletPaymentOffline: true,
      maximumOfflineWalletAmountPerBill: 2000,
    };
    assert.equal(offlineWalletError(settings, 100), '');
  });

  it('uses cached wallet discount rules when offline wallet payments are enabled', () => {
    const bill = calculateOfflineBill([{
      productId: 'product-1',
      name: 'Tea',
      ownerType: 'VENDOR',
      mrp: 100,
      vendorPrice: 55,
      quantity: 1,
      unit: 'PACKAGE',
      vatApplicable: false,
    }], null, ['WALLET'], {
      allowWalletPaymentOffline: true,
      shareholderDiscountPercent: 0,
      discountLimitByRole: { Cashier: 5 },
      role: 'Cashier',
    });

    assert.equal(bill.grandTotal, 100);
    assert.equal(bill.shareholderDiscountAmount, 0);
  });

  it('expires offline sessions at the configured limit and never after 24 hours', () => {
    const now = Date.now();
    const token = `x.${btoa(JSON.stringify({ exp: Math.floor((now + 30 * 60 * 60 * 1000) / 1000) }))}.x`;
    const session = {
      token,
      user: { offlineSessionHours: 48 },
      loggedInAt: new Date(now).toISOString(),
    };
    assert.equal(offlineSessionIsValid(session, now + 23 * 60 * 60 * 1000), true);
    assert.equal(offlineSessionIsValid(session, now + 25 * 60 * 60 * 1000), false);
  });
});
