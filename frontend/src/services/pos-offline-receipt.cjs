function createOfflineReceipt(bill, queuedBill, user, outletId, payments) {
  const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return {
    orderNumber: queuedBill.offlineNumber,
    soldAt: queuedBill.soldAt,
    outlet: outletId,
    cashier: user.id,
    lines: bill.ledgerLines.map((line, index) => {
      const { item, pricing } = bill.lines[index];
      return {
        productId: item.productId,
        productName: item.name,
        barcode: item.barcode,
        quantity: item.quantity,
        unit: item.unit === 'PIECE' ? 'PIECE' : 'PACKAGE',
        packageUnitName: item.packageUnitName,
        mrp: pricing.unitPrice,
        subtotal: line.subtotal,
        itemDiscountAmount: line.itemDiscountAmount,
        billDiscountAmount: line.billDiscountAmount,
        shareholderDiscountAmount: line.shareholderDiscountAmount,
        vatAmount: line.vatAmount,
        total: money(line.subtotal - line.discountAmount + line.vatAmount),
      };
    }),
    subtotal: bill.subtotal,
    otherDiscountAmount: bill.otherDiscountAmount,
    shareholderDiscountAmount: 0,
    vatAmount: bill.vatAmount,
    grandTotal: bill.grandTotal,
    payments,
    walletOffline: queuedBill.payload.walletOffline === true,
  };
}

module.exports = { createOfflineReceipt };
