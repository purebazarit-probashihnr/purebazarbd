import { formatMoney } from '../../services/money-format.cjs';

export const formatPayrollMoney = (value) => formatMoney(value);

export function formatPayrollDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-BD', { dateStyle: 'medium' }).format(date);
}

export function employeeId(value) {
  return typeof value === 'string' ? value : value?._id || '';
}

export function monthNow(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 7);
}
