import { formatMoney, roundHalfUp } from '../../services/money-format.cjs';

export function localDateInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function firstDayOfMonth(date = new Date()) {
  return `${localDateInput(date).slice(0, 7)}-01`;
}

export const formatFinanceMoney = (value) => formatMoney(value);

export function formatFinanceDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-BD', { dateStyle: 'medium' }).format(date);
}

// Whole taka, each row rounded half up, so shown rows add up to the total.
export function sumWholeMoney(rows, field) {
  return rows.reduce((sum, row) => sum + roundHalfUp(row[field]), 0);
}
