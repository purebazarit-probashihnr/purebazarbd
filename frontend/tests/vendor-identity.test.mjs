import test from 'node:test';
import assert from 'node:assert/strict';
import identity from '../src/services/vendor-identity.cjs';

const vendor = {
  name: 'Local Vendor',
  shopName: 'Local Shop',
  vendorCode: 'VND-0001',
};

test('vendor dropdown labels use vendor codes when there is no member ID', () => {
  assert.equal(identity.vendorIdentifier(vendor), 'VND-0001');
  assert.equal(identity.vendorLabel(vendor), 'Local Vendor - Local Shop (VND-0001)');
});

test('vendor dropdown search matches non-member name, shop, and vendor code', () => {
  for (const query of ['Local Vendor', 'Local Shop', 'VND-0001']) {
    assert.equal(identity.matchesVendor(vendor, query), true, query);
  }
  assert.equal(identity.matchesVendor(vendor, 'not found'), false);
});

test('Probashi member IDs take precedence over a retained vendor code', () => {
  const member = { ...vendor, memberId: 'phr0007' };
  assert.equal(identity.vendorIdentifier(member), 'phr0007');
  assert.equal(identity.vendorLabel(member), 'Local Vendor - Local Shop (phr0007)');
  assert.equal(identity.matchesVendor(member, 'VND-0001'), true);
});
