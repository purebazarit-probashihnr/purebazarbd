import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getUnitOptions } = require('../src/services/barcodeUnits.js');
const { addReceiveProductLine } = require('../src/services/goods-receive-utils.cjs');
const {
  barcodeSourceForEntry, buildBarcodeLabels, findInternalBarcodeConflict,
  isValidEan8, isValidUpcA, retailBarcodeWarning,
} = require('../src/services/barcodeEngine.js');

const product = {
  name: 'Basmati Rice', barcode: '4006381333931', mrp: 500, unitValue: 5,
  packageUnitName: 'Bag', unitsPerPackage: 10, subUnitPrice: 55,
};

test('unit options use POS pricing rules', () => {
  const options = getUnitOptions(product);
  assert.deepEqual(options.slice(0, 2).map((o) => [o.name, o.price]), [['Bag', 100], ['Pcs', 55]]);
});

test('label shows product name with selected unit and its price', () => {
  const [piece] = getUnitOptions(product).slice(1);
  const { labels } = buildBarcodeLabels([{ ...product, unitName: piece.name, price: piece.price }], 'price');
  assert.equal(labels[0].name, 'Basmati Rice (Pcs)');
  assert.equal(labels[0].price, '55.00');
});

test('long names keep the unit suffix', () => {
  const { labels } = buildBarcodeLabels([{ ...product, name: 'X'.repeat(60), unitName: 'Carton', price: 1 }], 'price');
  assert.ok(labels[0].name.endsWith('(Carton)'));
  assert.ok(labels[0].name.length <= 40);
});

test('label size changes TSPL paper dimensions', () => {
  const item = { ...product, price: 100, originalPrice: 120 };
  assert.match(buildBarcodeLabels([item], 'price', '38x25').tspl, /SIZE 38 mm,25 mm/);
  assert.match(buildBarcodeLabels([item], 'price', '32x18').tspl, /SIZE 32 mm,18 mm/);
  assert.throws(() => buildBarcodeLabels([item], 'price', '1x1'));
});

test('dropdown includes universal units without rescaling price', () => {
  const names = getUnitOptions(product).map((o) => o.name);
  for (const n of ['Box', 'Pcs', 'Pack', 'Kg', 'Gram', 'Liter']) assert.ok(names.includes(n), n);
  const box = getUnitOptions(product).find((o) => o.name === 'Box');
  assert.equal(box.price, 500);
});

test('validates EAN-8 and UPC-A check digits without blocking label output', () => {
  assert.equal(isValidEan8('96385074'), true);
  assert.equal(isValidUpcA('036000291452'), true);
  assert.match(retailBarcodeWarning('036000291453'), /UPC-A check digit is invalid/);
  assert.equal(buildBarcodeLabels([{ ...product, barcode: 'PB-0123ABCDE', price: 500 }]).labels[0].barcode, 'PB-0123ABCDE');
});

test('typed 29 codes remain manufacturer codes and show the reserved-range warning', () => {
  assert.equal(barcodeSourceForEntry('2901234567890'), 'manufacturer');
  assert.match(retailBarcodeWarning('2901234567890'), /range reserved for in-store codes/);
  assert.match(retailBarcodeWarning('2901234567890'), /EAN-13 check digit is invalid/);
  assert.equal(barcodeSourceForEntry(''), 'internal');
});

test('form lookup blocks another group internal code but leaves manufacturer matches available', () => {
  const internal = {
    id: 'p2', name: 'Existing Rice', productGroupId: 'group-2',
    barcode: '2900000000013', barcodeSource: 'internal',
  };
  assert.equal(findInternalBarcodeConflict([internal], 'group-1'), internal);
  assert.equal(findInternalBarcodeConflict([internal], 'group-2'), null);
  assert.equal(findInternalBarcodeConflict([{
    ...internal, barcodeSource: 'manufacturer',
  }], 'group-1'), null);
});

test('adding a GRN vendor copy creates a line for that newly copied product', () => {
  const copiedProduct = {
    id: 'vendor-copy-id',
    name: 'Tea',
    displayName: 'Tea [Box]',
    barcode: 'PB-TEA',
    vendorName: 'Current vendor',
    packageUnitName: 'Box',
  };
  const lines = addReceiveProductLine([], copiedProduct);
  assert.deepEqual(lines[0], {
    productId: 'vendor-copy-id',
    productName: 'Tea [Box]',
    barcode: 'PB-TEA',
    vendorName: 'Current vendor',
    isWeightBased: false,
    receivedQuantity: 1,
    acceptedQuantity: 1,
    rejectedQuantity: 0,
  });
});
