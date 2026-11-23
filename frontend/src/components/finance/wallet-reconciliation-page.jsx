'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { useSelector } from 'react-redux';
import { Badge, Button, Card, Input, Modal, Table } from '@/components/ui';
import {
  getOfflineWalletBills, getWalletReconciliation, resolveWalletReconciliation,
  runWalletReconciliation, verifyOfflineWalletBill,
} from '@/services/finance';
import { formatFinanceDate, formatFinanceMoney, localDateInput } from './finance-utils';
import { T } from '@/i18n/language-provider';
import useToastMessages from '@/hooks/use-toast-messages';

function statusBadge(record) {
  if (record.status === 'Matched') return <Badge tone="success">Matched</Badge>;
  if (record.status === 'Pending') return <Badge tone="neutral">Pending</Badge>;
  return <Badge tone={record.resolved ? 'info' : 'danger'}>{record.resolved ? 'Resolved' : 'Mismatch'}</Badge>;
}

export default function WalletReconciliationPage() {
  const { token, user, initialized } = useSelector((state) => state.auth);
  const permissions = user?.permissions || [];
  const canRead = permissions.includes('*') || permissions.includes('finance:read');
  const canWrite = permissions.includes('*') || permissions.includes('finance:write');
  const [date, setDate] = useState(localDateInput());
  const [data, setData] = useState({ records: [], totals: { matched: 0, mismatch: 0, pending: 0, unresolved: 0 } });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useToastMessages({ success: notice, error });
  const [resolving, setResolving] = useState(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [offlineWallets, setOfflineWallets] = useState([]);
  const [offlineWalletTotals, setOfflineWalletTotals] = useState({
    pending: 0, verified: 0, mismatch: 0, notFound: 0, unverifiable: 0, flagged: 0,
  });
  const [offlineWalletDateTotal, setOfflineWalletDateTotal] = useState({ count: 0, amount: 0 });
  const [offlineWalletLoading, setOfflineWalletLoading] = useState(true);
  const [verifyingWalletId, setVerifyingWalletId] = useState('');

  useEffect(() => {
    if (!token || !canRead) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    getWalletReconciliation(token, date)
      .then(({ data: result }) => active && setData(result))
      .catch((requestError) => active && setError(
        requestError.response?.data?.message || 'Unable to load wallet reconciliation.',
      ))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [canRead, date, reload, token]);

  useEffect(() => {
    if (!token || !canRead) return undefined;
    let active = true;
    setOfflineWalletLoading(true);
    getOfflineWalletBills(token, date)
      .then(({ data: result }) => {
        if (!active) return;
        setOfflineWallets(result.orders);
        setOfflineWalletTotals(result.totals);
        setOfflineWalletDateTotal(result.dateTotal);
      })
      .catch((requestError) => active && setError(
        requestError.response?.data?.message || 'Unable to load offline wallet bills.',
      ))
      .finally(() => active && setOfflineWalletLoading(false));
    return () => { active = false; };
  }, [canRead, date, reload, token]);

  async function runReconciliation() {
    setRunning(true);
    setError('');
    setNotice('');
    try {
      const { data: result } = await runWalletReconciliation(token, date);
      setData(result);
      setNotice(`Reconciliation completed for ${date}.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to run wallet reconciliation.');
    } finally {
      setRunning(false);
    }
  }

  async function resolveMismatch(event) {
    event.preventDefault();
    if (!resolving || reason.trim().length < 3) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await resolveWalletReconciliation(token, resolving._id, reason.trim());
      setResolving(null);
      setReason('');
      setNotice(`Mismatch for bill ${resolving.orderNumber} was resolved.`);
      setReload((value) => value + 1);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to resolve this mismatch.');
    } finally {
      setSaving(false);
    }
  }

  async function verifyNow(order) {
    setVerifyingWalletId(order._id);
    setError('');
    setNotice('');
    try {
      const { data: result } = await verifyOfflineWalletBill(
        token, order._id, String(order.outlet?._id || order.outlet || ''),
      );
      setOfflineWallets((current) => current.map((item) => (
        item._id === order._id ? result.order : item
      )));
      setNotice(`Wallet bill ${order.orderNumber} verification: ${result.order.walletVerification}.`);
      setReload((value) => value + 1);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to verify this offline wallet bill.');
    } finally {
      setVerifyingWalletId('');
    }
  }

  const offlineWalletColumns = [
    { key: 'orderNumber', label: 'Bill', render: (value, order) => <div><strong>{value}</strong><small className="block text-slate-500">{new Date(order.soldAt || order.createdAt).toLocaleString()}</small></div> },
    { key: 'grandTotal', label: 'Amount', render: formatFinanceMoney },
    { key: 'cashier', label: 'Cashier', render: (cashier) => cashier?.name || '—' },
    { key: 'outlet', label: 'Outlet', render: (outlet) => outlet?.name || '—' },
    {
      key: 'walletVerification',
      label: 'Verification',
      render: (value, order) => (
        <div>
          <Badge tone={value === 'verified' ? 'success' : value === 'pending' ? 'warning' : 'danger'}>
            {value || 'pending'}
          </Badge>
          {order.walletVerificationReason && <small className="mt-1 block max-w-64 text-slate-600">{order.walletVerificationReason}</small>}
        </div>
      ),
    },
    {
      key: 'action',
      label: 'Action',
      render: (_, order) => (
        <Button size="sm" variant="secondary" disabled={!canWrite || verifyingWalletId === order._id}
          onClick={() => verifyNow(order)}>
          {verifyingWalletId === order._id ? 'Verifying…' : 'Verify now'}
        </Button>
      ),
    },
  ];

  const columns = [
    { key: 'orderNumber', label: 'Wallet bill' },
    { key: 'memberId', label: 'Member ID' },
    { key: 'amount', label: 'Bill amount', render: formatFinanceMoney },
    {
      key: 'probashiTransactionId',
      label: 'Probashi transaction',
      render: (value, record) => value || (record.mismatchType === 'MISSING' ? 'Not found' : '—'),
    },
    { key: 'probashiAmount', label: 'Probashi amount', render: (value) => value == null ? '—' : formatFinanceMoney(value) },
    { key: 'status', label: 'Status', render: (_, record) => <div className="space-y-1">{statusBadge(record)}{record.mismatchType && <small className="block text-slate-500">{record.mismatchType === 'MISSING' ? 'Missing transaction' : 'Amount mismatch'}</small>}</div> },
    {
      key: 'action',
      label: 'Action',
      render: (_, record) => record.status === 'Mismatch' && !record.resolved
        ? <Button size="sm" variant="secondary" disabled={!canWrite} onClick={() => { setResolving(record); setReason(''); }}>Resolve</Button>
        : record.resolved ? <span className="text-xs text-slate-500" title={record.resolutionReason}><T>{"Reason recorded"}</T></span> : '—',
    },
  ];

  if (!initialized) return <p role="status" className="py-10 text-center text-sm text-slate-500"><T>{"Loading wallet reconciliation..."}</T></p>;
  if (!token || !canRead) return <p role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><T>{"You do not have permission to view wallet reconciliation."}</T></p>;

  const totals = data.totals;
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-slate-500"><T>{"Finance"}</T></p>
          <h1 className="text-2xl font-semibold text-slate-900"><T>{"Wallet Reconciliation"}</T></h1>
          <p className="mt-1 text-sm text-slate-600"><T>{"Compare POS wallet bills with the member's Probashi transaction report."}</T></p>
        </div>
        <Button variant="secondary" onClick={() => setReload((value) => value + 1)} disabled={loading || running}>
          <RefreshCw size={16} /> Refresh
        </Button>
      </div>


      <Card title="Daily reconciliation" description="Run once the day's wallet transactions are available. The run is idempotent; resolved mismatches are preserved." actions={
        <Button onClick={runReconciliation} disabled={!canWrite || loading || running || !date || date > localDateInput()}>
          {running ? 'Reconciling...' : 'Run reconciliation'}
        </Button>
      }>
        <div className="max-w-xs">
          <Input label="Business date" name="date" type="date" max={localDateInput()} value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        {!canWrite && <p className="mt-3 text-sm text-slate-500"><T>{"Read-only access. Finance write permission is required to run or resolve reconciliation records."}</T></p>}
      </Card>

      <Card title="Offline wallet bills" description="These sales are saved and included in revenue; verification never reverses a sale.">
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">Total offline wallet bills · {date}</p>
          <strong className="text-xl">{formatFinanceMoney(offlineWalletDateTotal.amount)}</strong>
          <p className="mt-1 text-sm text-slate-500">{offlineWalletDateTotal.count} bill(s) · compare with the Probashi settlement report.</p>
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card><small className="text-slate-500">Pending</small><strong className="mt-1 block text-xl">{offlineWalletTotals.pending}</strong></Card>
          <Card><small className="text-slate-500">Verified</small><strong className="mt-1 block text-xl text-green-700">{offlineWalletTotals.verified}</strong></Card>
          <Card><small className="text-slate-500">Mismatch</small><strong className="mt-1 block text-xl text-red-700">{offlineWalletTotals.mismatch}</strong></Card>
          <Card><small className="text-slate-500">Not found</small><strong className="mt-1 block text-xl text-red-700">{offlineWalletTotals.notFound}</strong></Card>
          <Card><small className="text-slate-500">Unverifiable</small><strong className="mt-1 block text-xl text-red-700">{offlineWalletTotals.unverifiable}</strong></Card>
        </div>
        {offlineWalletTotals.flagged > 0 && (
          <p role="status" className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {offlineWalletTotals.flagged} offline wallet bill(s) need attention.
          </p>
        )}
        {offlineWalletLoading ? <p role="status">Loading offline wallet bills…</p> : (
          <Table columns={offlineWalletColumns} rows={offlineWallets} rowKey="_id" emptyMessage="No offline wallet bills." />
        )}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card title="Matched"><p className="text-2xl font-semibold text-green-700">{totals.matched}</p></Card>
        <Card title="Mismatches"><p className="text-2xl font-semibold text-red-700">{totals.mismatch}</p></Card>
        <Card title="Pending"><p className="text-2xl font-semibold text-slate-700">{totals.pending}</p></Card>
        <Card title="Unresolved"><p className="flex items-center gap-2 text-2xl font-semibold text-amber-700"><AlertTriangle size={20} />{totals.unresolved}</p></Card>
      </div>

      {totals.unresolved > 0 && (
        <p role="status" className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle size={17} /> {totals.unresolved} wallet mismatch(es) remain unresolved for {date}.
        </p>
      )}
      {totals.unresolved === 0 && data.records.length > 0 && (
        <p role="status" className="flex items-center gap-2 rounded border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 size={17} /> No unresolved wallet mismatches for {date}.
        </p>
      )}

      <Card title="Wallet bills" description={`${data.records.length} bill(s) for ${formatFinanceDate(`${date}T00:00:00`)}.`}>
        {loading ? <p role="status" className="py-8 text-center text-sm text-slate-500"><T>{"Loading reconciliation records..."}</T></p> : (
          <Table columns={columns} rows={data.records} rowKey="_id" emptyMessage="No wallet bills have been reconciled for this date. Run reconciliation to check the day's bills." />
        )}
      </Card>

      <Modal
        open={Boolean(resolving)}
        onClose={() => !saving && setResolving(null)}
        title={`Resolve mismatch${resolving ? ` · ${resolving.orderNumber}` : ''}`}
      >
        {resolving && (
          <form className="space-y-4" onSubmit={resolveMismatch}>
            <p className="text-sm text-slate-600"><T>{"Record why this mismatch is considered resolved. This action cannot be undone."}</T></p>
            <label className="ui-field" htmlFor="resolution-reason">
              <span className="field-label"><T>{"Resolution reason"}</T></span>
              <textarea id="resolution-reason" className="ui-input min-h-24" minLength={3} maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} />
              <span className="text-xs text-slate-500">{reason.trim().length}/500 characters (minimum 3)</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setResolving(null)} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving || reason.trim().length < 3}>{saving ? 'Saving...' : 'Resolve mismatch'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </section>
  );
}
