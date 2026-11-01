const { roundHalfUp } = require('../utils/money');

// All money below is whole taka (integers), rounded half up per line and per discount, so lines add up to the total.
function requireNumber(value, name, { min = 0, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${name} must be a number from ${min} to ${max}`);
  }
  return value;
}

function discountAmount(discount, base, name) {
  if (discount == null) return 0;
  if (!discount || !['PERCENT', 'FIXED'].includes(discount.type)) {
    throw new TypeError(`${name} type must be PERCENT or FIXED`);
  }
  const value = requireNumber(discount.value, `${name} value`, {
    max: discount.type === 'PERCENT' ? 100 : Infinity,
  });
  if (value > 0 && (typeof discount.reason !== 'string' || !discount.reason.trim())) {
    throw new TypeError(`${name} reason is required`);
  }
  if (value > 0 && /\bshareholder\b/i.test(discount.reason)) {
    throw new TypeError(`${name} reason cannot refer to a shareholder discount; it is applied automatically`);
  }
  const amount = discount.type === 'PERCENT'
    ? roundHalfUp(base * value / 100)
    : roundHalfUp(value);
  return Math.min(base, amount);
}

function allocate(amount, weights) {
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  if (!amount || !weightTotal) return weights.map(() => 0);
  let remaining = amount;
  return weights.map((weight, index) => {
    const allocation = index === weights.length - 1
      ? remaining
      : Math.min(remaining, roundHalfUp(amount * weight / weightTotal));
    remaining -= allocation;
    return allocation;
  });
}

function calculateBill({ items, paymentMethod, shareholder, billDiscount, settings = {} }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('items must be a non-empty array');
  }
  if (!['WALLET', 'CASH', 'BKASH', 'NAGAD', 'CARD'].includes(paymentMethod)) {
    throw new TypeError('paymentMethod is not supported');
  }
  const vatOrder = settings.vatCalculationOrder || 'DISCOUNT_THEN_VAT';
  if (!['DISCOUNT_THEN_VAT', 'VAT_THEN_DISCOUNT'].includes(vatOrder)) {
    throw new TypeError('vatCalculationOrder is not supported');
  }
  const vatEnabled = settings.vatEnabled === true;
  const defaultVatRate = requireNumber(settings.defaultVatRate ?? 0, 'defaultVatRate', { max: 100 });
  const shareholderPercent = requireNumber(settings.shareholderDiscountPercent ?? 5, 'shareholderDiscountPercent', { max: 100 });

  const lines = items.map((item, index) => {
    if (!item || !['COMPANY', 'VENDOR'].includes(item.ownerType)) {
      throw new TypeError(`items[${index}].ownerType must be COMPANY or VENDOR`);
    }
    const quantity = requireNumber(item.quantity, `items[${index}].quantity`, { min: 1 });
    if (!Number.isInteger(quantity)) throw new TypeError(`items[${index}].quantity must be a whole number`);
    const mrp = requireNumber(item.mrp, `items[${index}].mrp`);
    const vendorPrice = requireNumber(item.vendorPrice, `items[${index}].vendorPrice`);
    const subtotal = roundHalfUp(mrp * quantity);
    const itemDiscount = discountAmount(item.discount, subtotal, `items[${index}].discount`);
    const categoryVatRate = item.categoryVatRate ?? item.category?.vatRate;
    const vatRate = item.vatRate ?? categoryVatRate ?? defaultVatRate;
    requireNumber(vatRate, `items[${index}].vatRate`, { max: 100 });
    return {
      productId: item.productId,
      vendorId: item.vendorId,
      ownerType: item.ownerType,
      quantity,
      subtotal,
      itemDiscount,
      remaining: subtotal - itemDiscount,
      vendorPayable: item.ownerType === 'VENDOR' ? roundHalfUp(vendorPrice * quantity) : 0,
      vatRate: vatEnabled && item.vatApplicable === true ? vatRate : 0,
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const afterItemDiscount = lines.reduce((sum, line) => sum + line.remaining, 0);
  const billDiscountTotal = discountAmount(billDiscount, afterItemDiscount, 'billDiscount');
  const billAllocations = allocate(billDiscountTotal, lines.map((line) => line.remaining));
  lines.forEach((line, index) => {
    line.billDiscount = billAllocations[index];
    line.afterOtherDiscount = line.remaining - line.billDiscount;
  });

  const otherDiscount = lines.reduce((sum, line) => sum + line.itemDiscount + line.billDiscount, 0);
  const shareholderEligible = paymentMethod === 'WALLET' && shareholder?.verified === true;
  const afterOtherDiscount = lines.reduce((sum, line) => sum + line.afterOtherDiscount, 0);
  const shareholderDiscount = shareholderEligible
    ? roundHalfUp(afterOtherDiscount * shareholderPercent / 100)
    : 0;
  const shareholderAllocations = allocate(shareholderDiscount, lines.map((line) => line.afterOtherDiscount));

  let vatTotal = 0;
  const ledgerLines = lines.map((line, index) => {
    const vatBase = vatOrder === 'VAT_THEN_DISCOUNT'
      ? line.remaining
      : line.afterOtherDiscount - shareholderAllocations[index];
    const vat = roundHalfUp(vatBase * line.vatRate / 100);
    vatTotal += vat;
    const lineDiscount = line.itemDiscount + line.billDiscount + shareholderAllocations[index];
    return {
      productId: line.productId,
      vendorId: line.vendorId,
      ownerType: line.ownerType,
      quantity: line.quantity,
      subtotal: line.subtotal,
      itemDiscountAmount: line.itemDiscount,
      billDiscountAmount: line.billDiscount,
      shareholderDiscountAmount: shareholderAllocations[index],
      discountAmount: lineDiscount,
      vatRate: line.vatRate,
      vatAmount: vat,
      vendorPayable: line.vendorPayable,
      companyNet: (line.subtotal - line.vendorPayable) - lineDiscount,
    };
  });

  return {
    subtotal,
    otherDiscountAmount: otherDiscount,
    shareholderDiscountAmount: shareholderDiscount,
    vatAmount: vatTotal,
    grandTotal: subtotal - otherDiscount - shareholderDiscount + vatTotal,
    ledgerLines,
  };
}

module.exports = { calculateBill };
