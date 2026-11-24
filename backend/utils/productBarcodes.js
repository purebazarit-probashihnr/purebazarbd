const { randomBytes } = require('crypto');

const INTERNAL_BARCODE_PREFIX = 'PB';
const INTERNAL_COUNTER_ID = 'internal-product-barcode';
const MAX_INTERNAL_SERIAL = 9999999999;
const INTERNAL_GENERATION_ATTEMPTS = 100;

function generateInternalBarcode() {
  return `${INTERNAL_BARCODE_PREFIX}${randomBytes(8).toString('hex').toUpperCase()}`;
}

function ean13CheckDigit(value) {
  const digits = String(value || '');
  if (!/^\d{12}$/.test(digits)) throw new Error('EAN-13 check digit requires 12 digits.');
  const sum = [...digits].reduce((total, digit, index) => (
    total + Number(digit) * (index % 2 === 0 ? 1 : 3)
  ), 0);
  return String((10 - (sum % 10)) % 10);
}

function barcodeLookupValues(value) {
  const text = String(value || '').trim();
  if (/^\d{12}$/.test(text)) return [text, `0${text}`];
  if (/^0\d{12}$/.test(text)) return [text, text.slice(1)];
  return text ? [text] : [];
}

function barcodeFilter(value) {
  const values = [...new Set((Array.isArray(value) ? value : [value])
    .flatMap(barcodeLookupValues))];
  return {
    $or: [
      { barcode: { $in: values } },
      { barcodes: { $in: values } },
      { barcodeKeys: { $in: values } },
    ],
  };
}

function normalizeBarcodes(barcode, barcodes = []) {
  return [...new Set([barcode, ...(Array.isArray(barcodes) ? barcodes : [])]
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function barcodeMatches(product, barcode) {
  const values = barcodeLookupValues(barcode);
  return values.some((value) => (
    product.barcode === value
    || (product.barcodes || []).includes(value)
    || (product.barcodeKeys || []).includes(value)
  ));
}

function isInternalBarcodeProduct(product) {
  return product.barcodeSource === 'internal'
    || (!product.barcodeSource && String(product.barcode || '').startsWith(INTERNAL_BARCODE_PREFIX));
}

async function findInternalBarcodeConflict(Product, barcodes, {
  productGroupId, excludeProductId,
} = {}) {
  const values = [...new Set((Array.isArray(barcodes) ? barcodes : [barcodes])
    .flatMap(barcodeLookupValues))];
  if (!values.length) return null;
  const query = Product.find(barcodeFilter(values));
  const products = await (query.select
    ? query.select('_id name productGroupId barcode barcodes barcodeSource').lean()
    : query.lean());
  return products.find((product) => {
    if (excludeProductId && product._id.toString() === excludeProductId.toString()) return false;
    if (!isInternalBarcodeProduct(product)) return false;
    const existingGroupId = product.productGroupId || product._id;
    return !productGroupId || existingGroupId.toString() !== productGroupId.toString();
  }) || null;
}

async function nextInternalSequence(Counter) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: INTERNAL_COUNTER_ID },
        { $inc: { sequence: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      if (!counter || !Number.isInteger(counter.sequence) || counter.sequence < 1) {
        throw new Error('Unable to allocate an internal product barcode.');
      }
      return counter.sequence;
    } catch (error) {
      if (error.code !== 11000 || attempt === 2) throw error;
    }
  }
  throw new Error('Unable to allocate an internal product barcode.');
}

async function generateUniqueInternalBarcode(Product, Counter) {
  for (let attempt = 0; attempt < INTERNAL_GENERATION_ATTEMPTS; attempt += 1) {
    const serial = await nextInternalSequence(Counter);
    if (serial > MAX_INTERNAL_SERIAL) {
      throw new Error('The internal product barcode range has been exhausted.');
    }
    const body = `29${String(serial).padStart(10, '0')}`;
    const barcode = `${body}${ean13CheckDigit(body)}`;
    if (!(await Product.exists(barcodeFilter(barcode)))) return barcode;
  }
  throw new Error('Unable to allocate a unique internal product barcode after 100 attempts.');
}

module.exports = {
  INTERNAL_BARCODE_PREFIX,
  barcodeFilter,
  barcodeLookupValues,
  barcodeMatches,
  ean13CheckDigit,
  findInternalBarcodeConflict,
  generateInternalBarcode,
  generateUniqueInternalBarcode,
  isInternalBarcodeProduct,
  normalizeBarcodes,
};
