const { generateEan13Barcode, isValidEan13 } = require('../utils/productIdentifiers');

function prepareProductBarcodeUpdates(products, createBarcode = generateEan13Barcode) {
  const usedBarcodes = new Set(products.map(({ barcode }) => barcode).filter(Boolean));
  const reservedBarcodes = new Set();
  const updates = [];

  function nextBarcode() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const barcode = createBarcode();
      if (!isValidEan13(barcode)) {
        throw new Error('Barcode generator returned an invalid EAN-13 number');
      }
      if (!usedBarcodes.has(barcode) && !reservedBarcodes.has(barcode)) return barcode;
    }
    throw new Error('Unable to generate a unique product barcode');
  }

  products.forEach((product) => {
    if (isValidEan13(product.barcode)) return;
    const barcode = nextBarcode();
    reservedBarcodes.add(barcode);
    updates.push({ id: product._id, barcode });
  });

  return updates;
}

async function migrateProductBarcodes() {
  throw new Error('Deprecated: use migrate:vendor-product-barcodes (dry run by default; pass -- --apply to apply).');
}

async function main() {
  await migrateProductBarcodes();
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Product barcode migration failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { prepareProductBarcodeUpdates, migrateProductBarcodes };
