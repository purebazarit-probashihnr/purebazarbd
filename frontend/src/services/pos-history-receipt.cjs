function buildHistoryReceipt(order) {
  return {
    ...order,
    soldAt: order.soldAt || order.createdAt,
    isReprint: true,
    lines: (order.lines || []).map((line) => ({ ...line })),
    payments: (order.payments || []).map((payment) => ({ ...payment })),
  };
}

module.exports = { buildHistoryReceipt };
