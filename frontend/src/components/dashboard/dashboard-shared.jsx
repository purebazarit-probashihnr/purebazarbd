import { Card } from '@/components/ui';

import { formatMoney as formatWholeMoney } from '@/services/money-format.cjs';

export const timeFormat = new Intl.DateTimeFormat('en-BD', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Dhaka',
});

export const formatMoney = (amount) => formatWholeMoney(amount);

export function MetricCard({ label, value, description, icon: Icon, badge }) {
  return (
    <Card className="dash-kpi">
      <div className="dashboard-metric-top">
        <span className="dashboard-metric-label">{label}</span>
        <span className="dash-kpi-icon"><Icon size={18} /></span>
      </div>
      <strong className="dashboard-metric-value">{value}</strong>
      {badge}
      <span className="dashboard-metric-description">{description}</span>
    </Card>
  );
}

export function ProgressBar({ percent, label, tone = 'green' }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="dash-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <div className={`dash-progress-fill ${tone}`} style={{ width: `${value}%` }} />
    </div>
  );
}
