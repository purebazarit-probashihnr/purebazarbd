import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  calculateOfflineBill, offlineWalletError,
} = require('../src/services/pos-offline-engine.cjs');
const { offlineSessionIsValid } = require('../src/services/offline-session-utils.cjs');
const { isOfflinePosUser } = require('../src/services/offline-pos-access.cjs');

describe('offline POS billing and session', () => {
  it('allows only fixed-outlet cashiers and outlet managers', () => {
    assert.equal(isOfflinePosUser({
      role: 'Cashier', locationId: 'outlet-1', location: { type: 'OUTLET' },
    }), true);
    assert.equal(isOfflinePosUser({
      role: 'Outlet Cashier', locationId: { _id: 'outlet-1', type: 'OUTLET' },
    }), true);
    assert.equal(isOfflinePosUser({
      role: 'Outlet Manager', locationId: 'outlet-1', location: { type: 'OUTLET' },
    }), true);
    assert.equal(isOfflinePosUser({
      role: 'Super Admin', locationId: null, permissions: ['*'],
    }), false);
    assert.equal(isOfflinePosUser({
      role: 'Operations Manager', locationId: 'outlet-1',
      location: { type: 'OUTLET' }, canViewAllLocations: true,
    }), false);
  });

  it('blocks Super Admin offline sessions, catalog, queue, and held bills', () => {
    const authSource = readFileSync(new URL('../src/store/auth-slice.js', import.meta.url), 'utf8');
    const offlineSource = readFileSync(new URL('../src/hooks/use-pos-offline.js', import.meta.url), 'utf8');
    const posSource = readFileSync(new URL('../src/components/pos/pos-billing-page.jsx', import.meta.url), 'utf8');
    const billingSource = readFileSync(new URL('../src/hooks/use-pos-billing.js', import.meta.url), 'utf8');

    assert.match(authSource, /isOfflinePosUser\(data\.user\)/);
    assert.match(offlineSource, /if \(!offlineEnabled\)/);
    assert.match(posSource, /getPosScreenState/);
    assert.match(posSource, /<OfflineState state=\{screenState\}/);
    assert.match(billingSource, /Offline POS is available only for cashiers and outlet managers/);
  });

  it('keeps a cashier selling and syncing offline', () => {
    const cashier = {
      role: 'Cashier', locationId: 'outlet-1', location: { type: 'OUTLET' },
    };
    assert.equal(isOfflinePosUser(cashier), true);
    const bill = calculateOfflineBill([{
      productId: 'product-1', name: 'Tea', ownerType: 'VENDOR',
      vendorId: 'vendor-1', vendorPrice: 55, mrp: 100,
      quantity: 1, unit: 'PACKAGE', vatApplicable: false,
    }], null, ['CASH'], {
      role: cashier.role, vatEnabled: false, defaultVatRate: 0,
    });
    assert.equal(bill.grandTotal, 100);
    const offlineSource = readFileSync(new URL('../src/hooks/use-pos-offline.js', import.meta.url), 'utf8');
    assert.match(offlineSource, /syncOfflinePosBill/);
  });

  it('shows no offline-wallet verification messages on the POS or receipt', () => {
    const paymentPanel = readFileSync(
      new URL('../src/components/pos/payment-panel.jsx', import.meta.url),
      'utf8',
    );
    const invoice = readFileSync(
      new URL('../src/components/pos/invoice-modal.jsx', import.meta.url),
      'utf8',
    );
    const receipt = readFileSync(
      new URL('../src/services/pos-offline-receipt.cjs', import.meta.url),
      'utf8',
    );

    assert.match(paymentPanel, /Wallet pays/);
    assert.doesNotMatch(paymentPanel, /verification|verified|unverifiable/i);
    assert.doesNotMatch(invoice, /Wallet verification pending/i);
    assert.doesNotMatch(receipt, /walletVerification/);
  });

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
