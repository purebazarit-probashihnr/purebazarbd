import { Table } from '@/components/ui';
import { stockText } from '@/services/stock-units.cjs';

export const reportConfig = {
  sales: {
    title: 'Sales Report',
    description: 'Review paid sales by day or month.',
    metrics: [
      ['billCount', 'Paid bills', 'count'],
      ['subtotal', 'Subtotal', 'money'],
      ['discounts', 'Discounts', 'money'],
      ['vat', 'VAT', 'money'],
      ['totalSales', 'Total sales', 'money'],
    ],
    columns: [
      ['period', 'Period'],
      ['billCount', 'Bills', 'count'],
      ['subtotal', 'Subtotal', 'money'],
      ['discounts', 'Discounts', 'money'],
      ['vat', 'VAT', 'money'],
      ['totalSales', 'Total sales', 'money'],
    ],
  },
  stock: {
    title: 'Stock Report',
    description: 'Track stock movement, closing quantities, turnover, and low stock.',
    metrics: [],
    columns: [
      ['productName', 'Product'],
      ['barcode', 'Barcode'],
      ['opening', 'Opening', 'stockQuantity'],
      ['received', 'Received', 'stockQuantity'],
      ['sold', 'Sold net', 'stockQuantity'],
      ['otherChange', 'Other change', 'stockQuantity'],
      ['closing', 'Closing', 'stockQuantity'],
      ['onHand', 'On hand', 'stockQuantity'],
      ['turnover', 'Turnover', 'number'],
    ],
  },
  vendor: {
    title: 'Vendor Profitability',
    description: 'Compare vendor payables and company net earnings for the selected period.',
    metrics: [
      ['quantitySold', 'Quantity sold', 'quantity'],
      ['vendorPayable', 'Vendor payable', 'money'],
      ['companyNet', 'Company net', 'money'],
    ],
    columns: [
      ['vendorName', 'Vendor'],
      ['shopName', 'Shop'],
      ['vendorIdentifier', 'Member ID / Vendor code'],
      ['billCount', 'Bills', 'count'],
      ['quantitySold', 'Qty sold', 'quantity'],
      ['vendorPayable', 'Vendor payable', 'money'],
      ['companyNet', 'Company net', 'money'],
      ['marginPercentOfPayable', 'Margin %', 'percent'],
    ],
  },
  profitLoss: {
    title: 'Profit and Loss',
    description: 'Review margin, discounts, expenses, and net profit.',
    metrics: [
      ['marginIncome', 'Vendor margin income', 'money'],
      ['ownStockMargin', 'Own-stock margin', 'money'],
      ['discounts', 'Discounts', 'money'],
      ['expenses', 'Expenses', 'money'],
      ['netProfit', 'Net profit', 'money'],
    ],
    columns: [],
  },
  vatDiscount: {
    title: 'VAT and Discounts',
    description: 'Review paid bill VAT and discounts recorded in each business day.',
    metrics: [
      ['billCount', 'Paid bills', 'count'],
      ['vat', 'VAT', 'money'],
      ['itemDiscount', 'Item discounts', 'money'],
      ['billDiscount', 'Bill discounts', 'money'],
      ['shareholderDiscount', 'Shareholder discounts', 'money'],
      ['totalDiscount', 'Total discounts', 'money'],
    ],
    columns: [
      ['period', 'Period'],
      ['billCount', 'Bills', 'count'],
      ['vat', 'VAT', 'money'],
      ['itemDiscount', 'Item discount', 'money'],
      ['billDiscount', 'Bill discount', 'money'],
      ['shareholderDiscount', 'Shareholder discount', 'money'],
      ['totalDiscount', 'Total discount', 'money'],
    ],
  },
  attendance: {
    title: 'Attendance Report',
    description: 'Review rostered shifts, attendance, absences, late arrivals, and worked hours.',
    metrics: [],
    columns: [
      ['employeeCode', 'Employee code'],
      ['employeeName', 'Employee'],
      ['rosteredShifts', 'Rostered shifts', 'count'],
      ['attended', 'Attended', 'count'],
      ['absent', 'Absent', 'count'],
      ['lateCount', 'Late', 'count'],
      ['totalWorkedHours', 'Worked hours', 'number'],
    ],
  },
};

const moneyFormatter = new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT' });
const numberFormatter = new Intl.NumberFormat('en-BD', { maximumFractionDigits: 4 });

export function formatValue(value, kind) {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'money') return moneyFormatter.format(value);
  if (kind === 'percent') return `${numberFormatter.format(value)}%`;
  if (kind === 'count' || kind === 'quantity' || kind === 'number') return numberFormatter.format(value);
  return String(value);
}

export function ReportTable({ columns, rows, emptyMessage }) {
  const tableColumns = columns.map(([key, label, kind]) => ({
    key,
    label,
    render: (value, row) => kind === 'stockQuantity' ? stockText(value, row) : formatValue(value, kind),
  }));
  return <Table columns={tableColumns} rows={rows} rowKey="_id" pageSize={15} emptyMessage={emptyMessage} />;
}
