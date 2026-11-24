import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getExcludedVendorIds,
  findDuplicateVendorMessage,
} = require('../src/services/vendor-copy-utils.cjs');

test('vendor copy exclusions include the current vendor and all copies in the product group', () => {
  const product = { id: 'source', productGroupId: 'group-1', vendorId: 'vendor-a' };
  const products = [
    product,
    { id: 'copy-b', productGroupId: 'group-1', vendorId: 'vendor-b' },
    { id: 'other', productGroupId: 'group-2', vendorId: 'vendor-c' },
  ];

  assert.deepEqual(getExcludedVendorIds(product, products), ['vendor-a', 'vendor-b']);
});

test('same-product vendor copy reports a clear duplicate message', () => {
  const product = { id: 'source', productGroupId: 'group-1', vendorId: 'vendor-a' };
  const products = [
    product,
    { id: 'copy-b', productGroupId: 'group-1', vendorId: 'vendor-b' },
  ];

  assert.equal(
    findDuplicateVendorMessage(product, products, 'vendor-b'),
    'This vendor already has this product.',
  );
  assert.equal(findDuplicateVendorMessage(product, products, 'vendor-c'), '');
});
