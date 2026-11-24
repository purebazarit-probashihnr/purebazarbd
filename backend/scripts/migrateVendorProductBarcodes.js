const dotenv = require('dotenv');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { generateInternalBarcode, normalizeBarcodes } = require('../utils/productBarcodes');

dotenv.config({ path: path.join(__dirname, '../.env') });
dotenv.config();

const INDEX_NAME = 'product_owner_vendor_barcode_unique';
const INDEX_KEYS = { ownerType: 1, vendorId: 1, barcodeKeys: 1 };

function isOldGlobalBarcodeIndex(index) {
  const keys = index.key || {};
  return index.unique === true && Object.keys(keys).length === 1 && keys.barcode === 1;
}

function findBarcodeConflicts(products) {
  const seen = new Map();
  const conflicts = [];
  products.forEach((product) => {
    const scope = `${product.ownerType || 'COMPANY'}:${product.vendorId || ''}`;
    normalizeBarcodes(product.barcode, product.barcodes).forEach((barcode) => {
      const key = `${scope}:${barcode}`;
      if (seen.has(key)) {
        conflicts.push({
          barcode,
          ownerType: product.ownerType || 'COMPANY',
          vendorId: product.vendorId || null,
          productIds: [String(seen.get(key)), String(product._id)],
        });
      } else {
        seen.set(key, product._id);
      }
    });
  });
  return conflicts;
}

function makeIndexPlan(products, indexes) {
  return {
    scanned: products.length,
    oldIndexes: indexes.filter(isOldGlobalBarcodeIndex).map(({ name }) => name),
    newIndex: {
      name: INDEX_NAME,
      key: INDEX_KEYS,
      unique: true,
      partialFilterExpression: { barcodeKeys: { $exists: true } },
    },
    barcodeConflicts: findBarcodeConflicts(products),
    legacyGeneratedCount: products.filter((product) => !product.barcodeSource && Boolean(product.barcode)).length,
    backfillCount: products.filter((product) => (
      !Array.isArray(product.barcodeKeys)
      || !product.productGroupId
      || !product.barcodeSource
      || !product.barcode
    )).length,
  };
}

async function migrateVendorProductBarcodes({ apply = false } = {}) {
  const collection = mongoose.connection.db.collection('products');
  const [products, indexes] = await Promise.all([
    collection.find({}, {
      projection: { _id: 1, ownerType: 1, vendorId: 1, productGroupId: 1, barcode: 1, barcodes: 1, barcodeKeys: 1, barcodeSource: 1 },
    }).sort({ _id: 1 }).toArray(),
    collection.indexes(),
  ]);
  const plan = makeIndexPlan(products, indexes);
  if (!apply) return { ...plan, applied: false };
  if (plan.barcodeConflicts.length) {
    throw new Error(`Resolve same-vendor barcode conflicts before applying: ${JSON.stringify(plan.barcodeConflicts)}`);
  }

  const writes = products.map((product) => {
    const hadBarcode = Boolean(String(product.barcode || '').trim());
    const legacyUnmarkedCode = !product.barcodeSource && hadBarcode && !String(product.barcode).startsWith('PB');
    const shouldGenerate = !hadBarcode || legacyUnmarkedCode;
    const barcode = shouldGenerate
      ? generateInternalBarcode()
      : String(product.barcode).trim();
    const barcodeSource = shouldGenerate
      ? 'internal'
      : ['manufacturer', 'internal'].includes(product.barcodeSource)
        ? product.barcodeSource
        : (barcode.startsWith('PB') ? 'internal' : 'manufacturer');
    return {
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            barcode,
            barcodeKeys: normalizeBarcodes(barcode, product.barcodes),
            barcodeSource,
            productGroupId: product.productGroupId || product._id,
          },
        },
      },
    };
  });
  if (writes.length) await collection.bulkWrite(writes, { ordered: true });

  for (const indexName of plan.oldIndexes) await collection.dropIndex(indexName);
  await collection.createIndex(INDEX_KEYS, {
    unique: true,
    name: INDEX_NAME,
    partialFilterExpression: { barcodeKeys: { $exists: true } },
  });
  return { ...plan, applied: true };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  const apply = process.argv.includes('--apply');
  await connectDB(process.env.MONGODB_URI);
  const result = await migrateVendorProductBarcodes({ apply });
  console.log(`${apply ? 'Applied' : 'Dry run'} vendor barcode migration: ${JSON.stringify(result)}`);
  if (result.barcodeConflicts.length) process.exitCode = 2;
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Vendor barcode migration failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });
}

module.exports = {
  findBarcodeConflicts,
  isOldGlobalBarcodeIndex,
  makeIndexPlan,
  migrateVendorProductBarcodes,
};
