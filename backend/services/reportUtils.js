const { roundHalfUp } = require('../utils/money');
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const cents = (value) => roundHalfUp(value || 0);
const money = (value) => value;
const sumCents = (items, pick) => items.reduce((sum, item) => sum + cents(pick(item)), 0);

// Quantities keep up to 3 decimals (kg, litres) and are summed in thousandths.
const milli = (value) => roundHalfUp(value || 0);
const qty = (total) => total;

const parseDhakaDate = (value) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - DHAKA_OFFSET_MS);
};

// from/to are inclusive Asia/Dhaka calendar dates (YYYY-MM-DD); either may be omitted.
function periodBounds({ from, to } = {}) {
  return {
    start: from ? parseDhakaDate(from) : null,
    end: to ? new Date(parseDhakaDate(to).getTime() + DAY_MS) : null,
  };
}

const inPeriod = (date, { start, end }) => {
  const time = new Date(date).getTime();
  return (!start || time >= start.getTime()) && (!end || time < end.getTime());
};

const dhakaDay = (date) => new Date(new Date(date).getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
const bucketKey = (date, groupBy) => (groupBy === 'month' ? dhakaDay(date).slice(0, 7) : dhakaDay(date));
const soldAt = (order) => order.soldAt || order.createdAt;

const byKey = (a, b) => a.period.localeCompare(b.period);

module.exports = {
  cents, money, sumCents, milli, qty, periodBounds, inPeriod, dhakaDay, bucketKey, soldAt, byKey,
};
