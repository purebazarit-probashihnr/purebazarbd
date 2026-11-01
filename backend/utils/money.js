// Every shown, summed or stored amount is a whole taka, rounded half up. Calculations run on integers.
const TOLERANCE = 1e-9;

function roundHalfUp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.floor(Math.abs(number) + 0.5 + TOLERANCE);
  return number < 0 ? -rounded : rounded;
}

// Shared by every screen, receipt, report, PDF and Excel export: whole taka with thousands separators and no decimals.
function formatMoney(value, { symbol = '৳' } = {}) {
  const whole = roundHalfUp(value);
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${whole < 0 ? '-' : ''}${symbol}${digits}`;
}

module.exports = { roundHalfUp, formatMoney };
