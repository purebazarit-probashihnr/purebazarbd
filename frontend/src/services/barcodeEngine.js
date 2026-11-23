const BRAND_NAME = 'PureBazar';

const EAN_LEFT = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const EAN_LEFT_G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const EAN_RIGHT = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function isValidEan13(value) {
  if (!/^\d{13}$/.test(String(value || ''))) return false;
  const digits = String(value).split('').map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => (
    total + digit * (index % 2 === 0 ? 1 : 3)
  ), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

function isValidEan8(value) {
  const text = String(value || '');
  if (!/^\d{8}$/.test(text)) return false;
  const digits = [...text].map(Number);
  const sum = digits.slice(0, 7).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === digits[7];
}

function isValidUpcA(value) {
  const text = String(value || '');
  if (!/^\d{12}$/.test(text)) return false;
  const digits = [...text].map(Number);
  const sum = digits.slice(0, 11).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === digits[11];
}

function isValidRetailBarcode(value) {
  return isValidEan13(value) || isValidEan8(value) || isValidUpcA(value);
}

function retailBarcodeWarning(value) {
  const text = String(value || '').trim();
  if (!text || text.startsWith('PB')) return '';
  const warnings = [];
  if (text.startsWith('29')) {
    warnings.push('This code starts with 29, a range reserved for in-store codes; check that it is the manufacturer\'s code');
  }
  if (/^\d{8}$/.test(text) && !isValidEan8(text)) warnings.push('EAN-8 check digit is invalid.');
  if (/^\d{12}$/.test(text) && !isValidUpcA(text)) warnings.push('UPC-A check digit is invalid.');
  if (/^\d{13}$/.test(text) && !isValidEan13(text)) warnings.push('EAN-13 check digit is invalid.');
  return warnings.join(' ');
}

function findInternalBarcodeConflict(products, productGroupId, productId) {
  return (products || []).find((product) => {
    if (product.id === productId) return false;
    const internal = product.barcodeSource === 'internal'
      || (!product.barcodeSource && String(product.barcode || '').startsWith('PB'));
    const existingGroupId = product.productGroupId || product.id;
    return internal && (!productGroupId || existingGroupId !== productGroupId);
  }) || null;
}

function barcodeSourceForEntry(value) {
  return String(value || '').trim() ? 'manufacturer' : 'internal';
}

function getEan8Modules(barcode) {
  if (!isValidEan8(barcode)) throw new Error('A valid EAN-8 barcode is required.');
  const digits = String(barcode).split('').map(Number);
  const left = digits.slice(0, 4).map((digit) => EAN_LEFT[digit]).join('');
  const right = digits.slice(4).map((digit) => EAN_RIGHT[digit]).join('');
  return `101${left}01010${right}101`.split('').map((module) => module === '1');
}

function getBarcodeModules(value) {
  const text = String(value || '');
  if (isValidEan13(text)) return getEan13Modules(text);
  if (isValidUpcA(text)) return getEan13Modules(`0${text}`);
  if (isValidEan8(text)) return getEan8Modules(text);
  return getCode128Modules(text);
}

function getEan13Modules(barcode) {
  if (!isValidEan13(barcode)) throw new Error('A valid EAN-13 barcode is required.');
  const digits = String(barcode).split('').map(Number);
  const parity = EAN_PARITY[digits[0]];
  const middle = digits.slice(1, 7).map((digit, index) => (
    parity[index] === 'L' ? EAN_LEFT[digit] : EAN_LEFT_G[digit]
  )).join('');
  const right = digits.slice(7).map((digit) => EAN_RIGHT[digit]).join('');
  return `101${middle}01010${right}101`.split('').map((module) => module === '1');
}

function getCode128Modules(value) {
  const text = String(value || '');
  if (!text || !/^[\x20-\x7E]+$/.test(text)) {
    throw new Error('Code 128 requires non-empty printable ASCII text.');
  }
  const codes = [104, ...Array.from(text, (character) => character.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, index) => sum + (index ? code * index : code), 0) % 103;
  codes.push(checksum, 106);
  const modules = [];
  codes.forEach((code) => {
    let isBar = true;
    for (const width of CODE128_PATTERNS[code]) {
      for (let index = 0; index < Number(width); index += 1) modules.push(isBar);
      isBar = !isBar;
    }
  });
  return modules;
}

function safeText(value) {
  return String(value || '')
    .replace(/[\r\n\t"]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?')
    .slice(0, 40);
}

// Truncates only the product name so the unit suffix always survives the 40-char limit.
// A custom package size/weight tag (e.g. "5 Kg") replaces the plain unit name.
function labelName(name, unitName, sizeTag) {
  const tag = safeText(sizeTag).trim();
  const plainUnit = safeText(unitName).trim();
  // A bare quantity such as "5" gets the selected unit appended ("5 Kg"); a tag with its own unit text is kept as typed.
  const unit = tag && /^[\d.,\s/x×-]+$/i.test(tag) && plainUnit ? `${tag} ${plainUnit}` : tag || plainUnit;
  if (!unit) return safeText(name);
  const suffix = ` (${unit})`.slice(0, 20);
  return `${safeText(name).slice(0, 40 - suffix.length).trimEnd()}${suffix}`;
}

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) throw new Error('Each price label needs a valid product price.');
  return (Math.round((price + Number.EPSILON) * 100) / 100).toFixed(2);
}

function normalizeLabels(items, labelType) {
  if (!['barcode', 'price'].includes(labelType)) throw new Error('Label type must be barcode or price.');
  if (!Array.isArray(items) || items.length === 0) throw new Error('Select at least one product to print.');
  const labels = [];
  for (const item of items) {
    const barcode = String(item.barcode || '');
    if (!barcode || !/^[\x20-\x7E]+$/.test(barcode)) {
      throw new Error(`Product "${item.name}" has an invalid barcode.`);
    }
    const copies = Number(item.copies ?? 1);
    if (!Number.isInteger(copies) || copies < 1 || copies > 500) {
      throw new Error('Label copies must be a whole number from 1 to 500.');
    }
    const unitName = String(item.unitName || '').trim();
    const price = labelType === 'price' ? formatPrice(item.price ?? item.mrp) : '';
    const hasOriginal = labelType === 'price' && item.originalPrice !== undefined && item.originalPrice !== null && item.originalPrice !== '';
    const originalPrice = hasOriginal ? formatPrice(item.originalPrice) : '';
    if (hasOriginal && Number(originalPrice) <= Number(price)) {
      throw new Error(`Original price for "${item.name}" must be higher than the selling price.`);
    }
    const label = {
      name: labelName(item.name, unitName, item.packageTag),
      barcode,
      price,
      originalPrice,
    };
    for (let copy = 0; copy < copies; copy += 1) labels.push(label);
  }
  return labels;
}

// Dimensions in mm; layout values are printer dots at 203 dpi (8 dots/mm).
const LABEL_SIZES = {
  '50x30': { key: '50x30', label: '50mm x 30mm', width: 50, height: 30, x: 20, brandY: 6, nameY: 36, barY: 62, barH: 60, origY: 160, priceY: 180, priceX: 20 },
  '38x25': { key: '38x25', label: '38mm x 25mm', width: 38, height: 25, x: 8, brandY: 4, nameY: 24, barY: 46, barH: 50, origY: 126, priceY: 150, priceX: 8 },
  '32x18': { key: '32x18', label: '32mm x 18mm', width: 32, height: 18, x: 6, brandY: 2, nameY: 18, barY: 34, barH: 32, origY: 108, priceY: 108, priceX: 130 },
};
const DEFAULT_LABEL_SIZE = '50x30';

function getLabelSize(sizeKey) {
  const size = LABEL_SIZES[sizeKey || DEFAULT_LABEL_SIZE];
  if (!size) throw new Error('Unsupported label size.');
  return size;
}

function buildTspl(labels, size) {
  const barX = Math.max(0, Math.round((size.width * 8 - 190) / 2));
  return labels.map(({ name, barcode, price, originalPrice }) => [
    `SIZE ${size.width} mm,${size.height} mm`,
    'GAP 2 mm,0 mm',
    'CLS',
    `TEXT ${size.x},${size.brandY},"${size.key === '50x30' ? '3' : '0'}",0,1,1,"${BRAND_NAME}"`,
    `TEXT ${size.x},${size.nameY},"0",0,1,1,"${name}"`,
    `BARCODE ${barX},${size.barY},"${isValidEan13(barcode) ? 'EAN13' : isValidUpcA(barcode) ? 'UPCA' : isValidEan8(barcode) ? 'EAN8' : '128'}",${size.barH},1,0,2,2,"${barcode}"`,
    ...(originalPrice ? [
      `TEXT ${size.x},${size.origY},"0",0,1,1,"BDT ${originalPrice}"`,
      `BAR ${size.x},${size.origY + 8},${(originalPrice.length + 4) * 8},2`,
    ] : []),
    ...(price ? [`TEXT ${originalPrice ? size.priceX : size.x},${size.priceY},"0",0,1,1,"BDT ${price}"`] : []),
    'PRINT 1',
  ].join('\r\n')).join('\r\n');
}

function buildEscPos(labels) {
  const output = [0x1b, 0x40];
  const encoder = new TextEncoder();
  const appendText = (text) => output.push(...encoder.encode(text));
  labels.forEach(({ name, barcode, price, originalPrice }, index) => {
    output.push(0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01);
    appendText(`${BRAND_NAME}\n`);
    appendText(`${name}\n`);
    output.push(0x1b, 0x45, 0x00);
    if (originalPrice) {
      output.push(0x1b, 0x2d, 0x01);
      appendText(`BDT ${originalPrice}`);
      output.push(0x1b, 0x2d, 0x00);
      appendText('\n');
    }
    if (price) appendText(`BDT ${price}\n`);
    output.push(0x1d, 0x48, 0x02, 0x1d, 0x77, 0x02, 0x1d, 0x68, 0x50);
    if (isValidEan13(barcode)) {
      output.push(0x1d, 0x6b, 0x43, 0x0c, ...encoder.encode(barcode.slice(0, 12)), 0x0a);
    } else if (isValidUpcA(barcode)) {
      output.push(0x1d, 0x6b, 0x41, 0x0b, ...encoder.encode(barcode.slice(0, 11)), 0x0a);
    } else if (isValidEan8(barcode)) {
      output.push(0x1d, 0x6b, 0x45, 0x07, ...encoder.encode(barcode.slice(0, 7)), 0x0a);
    } else {
      output.push(0x1d, 0x6b, 0x49, 0x42, ...encoder.encode(barcode), 0x00);
    }
    output.push(0x0a, 0x0a);
    if (index === labels.length - 1) output.push(0x1d, 0x56, 0x00);
  });
  return new Uint8Array(output);
}

function buildBarcodeLabels(items, labelType = 'price', sizeKey = DEFAULT_LABEL_SIZE) {
  const size = getLabelSize(sizeKey);
  const labels = normalizeLabels(items, labelType);
  return { labels, size, tspl: buildTspl(labels, size), escPos: buildEscPos(labels) };
}

module.exports = {
  BRAND_NAME,
  DEFAULT_LABEL_SIZE,
  LABEL_SIZES,
  buildBarcodeLabels,
  barcodeSourceForEntry,
  getCode128Modules,
  getBarcodeModules,
  getEan8Modules,
  getEan13Modules,
  findInternalBarcodeConflict,
  isValidEan8,
  isValidEan13,
  isValidRetailBarcode,
  isValidUpcA,
  retailBarcodeWarning,
};
