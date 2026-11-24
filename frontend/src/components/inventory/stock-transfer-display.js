import { formatStockDisplay } from '@/services/stock-units.cjs';

export const qty = (value, line) => (line.isWeightBased ? formatStockDisplay(value, 'Gram') : value);
export const statuses = ['Requested', 'Dispatched', 'Received', 'Discrepancy'];
export const statusTone = {
  Requested: 'warning',
  Dispatched: 'info',
  Received: 'success',
  Discrepancy: 'danger',
};
export const displayId = (id) => id.slice(-8).toUpperCase();
export const formatDate = (value) => new Intl.DateTimeFormat('en-BD', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));
