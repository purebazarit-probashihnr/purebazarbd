import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { decideOfflineNavigation } = require('../public/offline-navigation.js');
const { isOfflinePosUser } = require('../src/services/offline-pos-access.cjs');
const { createOfflineProfile } = require('../src/services/offline-profile.cjs');

const outletCashier = {
  id: 'cashier-1',
  name: 'Cashier',
  role: 'Cashier',
  permissions: ['pos:read'],
  locationId: 'outlet-1',
  location: { id: 'outlet-1', name: 'Outlet One', type: 'OUTLET' },
  offlineSessionHours: 8,
};
const outletManager = {
  ...outletCashier,
  id: 'manager-1',
  role: 'Outlet Manager',
  permissions: ['pos.sales:write'],
};
const warehouseStaff = {
  ...outletCashier,
  id: 'warehouse-1',
  locationId: 'central-1',
  location: { id: 'central-1', name: 'Central Warehouse', type: 'CENTRAL' },
};
const superAdmin = {
  id: 'admin-1',
  role: 'Super Admin',
  permissions: ['*'],
  locationId: null,
  location: null,
  canViewAllLocations: true,
};
const multipleLocations = {
  ...outletCashier,
  locationIds: ['outlet-1', 'outlet-2'],
};

describe('offline POS eligibility', () => {
  it('allows cashier and outlet-manager users with POS permission at one outlet only', () => {
    assert.equal(isOfflinePosUser(outletCashier), true);
    assert.equal(isOfflinePosUser(outletManager), true);
  });

  it('rejects users without POS permission, Super Admin, warehouse, all-location, or multiple-location access', () => {
    assert.equal(isOfflinePosUser({ ...outletCashier, permissions: ['dashboard:read'] }), false);
    assert.equal(isOfflinePosUser(superAdmin), false);
    assert.equal(isOfflinePosUser(warehouseStaff), false);
    assert.equal(isOfflinePosUser({ ...outletCashier, canViewAllLocations: true }), false);
    assert.equal(isOfflinePosUser(multipleLocations), false);
  });
});

describe('service-worker offline navigation decision', () => {
  const now = Date.parse('2026-11-24T00:00:00.000Z');
  const validProfile = (user) => createOfflineProfile(user, '2026-11-23T23:00:00.000Z');

  it('stores only the navigation profile fields with the configured session expiry', () => {
    const profile = validProfile(outletCashier);
    assert.deepEqual(Object.keys(profile).sort(), [
      'eligible', 'expiresAt', 'name', 'outletId', 'outletName', 'role', 'userId',
    ]);
    assert.equal(profile.eligible, true);
    assert.equal(profile.expiresAt, '2026-11-24T07:00:00.000Z');
  });

  for (const [label, user] of [
    ['cashier', outletCashier],
    ['outlet manager', outletManager],
  ]) {
    it(`redirects an eligible ${label} from /dashboard and / to POS`, () => {
      const profile = validProfile(user);
      assert.deepEqual(decideOfflineNavigation(profile, now, 'https://purebazar.test/dashboard'), {
        screen: 'pos', redirectTo: '/orders/pos',
      });
      assert.deepEqual(decideOfflineNavigation(profile, now, 'https://purebazar.test/'), {
        screen: 'pos', redirectTo: '/orders/pos',
      });
    });
  }

  it('requires sign-in for an expired cashier session or a device with no profile', () => {
    const expired = createOfflineProfile(outletCashier, '2026-11-23T00:00:00.000Z');
    assert.equal(decideOfflineNavigation(expired, now, '/dashboard').screen, 'sign-in-required');
    assert.equal(decideOfflineNavigation(null, now, '/dashboard').screen, 'sign-in-required');
  });

  it('shows the existing offline card for Super Admin, warehouse staff, and multiple locations', () => {
    for (const user of [superAdmin, warehouseStaff, multipleLocations]) {
      assert.equal(decideOfflineNavigation(validProfile(user), now, '/dashboard').screen, 'offline');
    }
  });
});
