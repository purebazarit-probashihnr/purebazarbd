const { roundHalfUp } = require('./money-format.cjs');

const paymentLabels = {
  CASH: 'Cash',
  BKASH: 'bKash',
  NAGAD: 'Nagad',
  CARD: 'Card',
  WALLET: 'Wallet',
  BANK: 'Bank',
};

function buildSalesHistoryParams(filters = {}) {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function isWalletSale(order) {
  return Boolean(order?.payments?.some((payment) => payment.method === 'WALLET'));
}

function paymentMethodLabel(method) {
  return paymentLabels[method] || method || '—';
}

// Each amount is a whole taka (half up) so shown lines add up to the total.
function sumMoney(values) {
  return values.reduce((total, value) => total + roundHalfUp(value), 0);
}

module.exports = {
  buildSalesHistoryParams,
  isWalletSale,
  paymentMethodLabel,
  sumMoney,
};
