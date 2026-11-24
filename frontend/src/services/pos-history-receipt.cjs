function buildHistoryReceipt(order) {
  const receipt = { ...order };
  delete receipt.walletVerification;
  delete receipt.walletVerificationReason;
  delete receipt.walletVerificationCheckedAt;
  return {
    ...receipt,
    soldAt: order.soldAt || order.createdAt,
    isReprint: true,
    lines: (order.lines || []).map((line) => ({ ...line })),
    payments: (order.payments || []).map((payment) => ({ ...payment })),
  };
}

module.exports = { buildHistoryReceipt };
