const { calculateBill } = require('../../../backend/services/billEngine');
const { linePricing } = require('../../../backend/utils/piecePricing');

function calculateOfflineBill(items, billDiscount, methods, settings) {
  if (!methods.length) {
    throw new Error('Select at least one payment method.');
  }
  const wallet = methods.includes('WALLET');
  if (wallet && (methods.length !== 1 || settings.allowWalletPaymentOffline !== true)) {
    throw new Error('Wallet payments require an internet connection.');
  }
  const firstMethod = methods[0];
  const lines = items.map((item) => {
    const pricing = linePricing(item, item);
    if (!pricing) throw new Error(`${item.name} cannot be sold by the piece.`);
    return {
      item,
      pricing,
      engineItem: {
        productId: item.productId,
        vendorId: item.vendorId,
        ownerType: item.ownerType,
        quantity: item.quantity,
        mrp: pricing.unitPrice,
        vendorPrice: pricing.unitVendorPrice,
        vatApplicable: item.vatApplicable,
        vatRate: item.vatRate,
        categoryVatRate: item.categoryVatRate,
        discount: item.discount,
      },
    };
  });
  const bill = calculateBill({
    items: lines.map((line) => line.engineItem),
    paymentMethod: firstMethod,
    shareholder: wallet ? { verified: true } : null,
    billDiscount,
    settings,
  });
  const roleLimit = Number(settings.discountLimitByRole?.[settings.role] ?? 0);
  const discountApprovalRequired = bill.subtotal > 0
    && (bill.otherDiscountAmount / bill.subtotal) * 100 > roleLimit;
  return {
    ...bill,
    discountApprovalRequired,
    ledgerLines: bill.ledgerLines,
    lines,
  };
}

function offlineWalletError(settings, total, memberId, reference) {
  if (settings.allowWalletPaymentOffline !== true) {
    return 'Wallet payments require an internet connection.';
  }
  const maximum = Number(settings.maximumOfflineWalletAmountPerBill ?? 2000);
  if (Number(total) > maximum) {
    return `Offline wallet payment is limited to ৳${maximum.toFixed(2)} per bill.`;
  }
  if (settings.requireMemberIdAndReferenceForOfflineWallet === true
    && (!String(memberId || '').trim() || !String(reference || '').trim())) {
    return 'Enter both the member ID and Probashi transaction reference for an offline wallet payment.';
  }
  return '';
}

module.exports = { calculateOfflineBill, offlineWalletError };
