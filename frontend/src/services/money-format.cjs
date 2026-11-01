// Shared by every screen, receipt and PDF: whole taka, rounded half up, no decimals.
const TOLERANCE = 1e-9;

function roundHalfUp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.floor(Math.abs(number) + 0.5 + TOLERANCE);
  return number < 0 ? -rounded : rounded;
}

function formatMoney(value, { symbol = '৳' } = {}) {
  const whole = roundHalfUp(value);
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${whole < 0 ? '-' : ''}${symbol}${digits}`;
}

// Whole numbers with thousands separators for counts and quantities.
function formatWhole(value) {
  return formatMoney(value, { symbol: '' });
}

module.exports = { roundHalfUp, formatMoney, formatWhole };
