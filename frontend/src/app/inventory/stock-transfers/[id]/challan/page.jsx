'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSelector } from 'react-redux';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button } from '@/components/ui';
import Code128BarcodeGraphic from '@/components/inventory/code128-barcode-graphic';
import { formatStockDisplay } from '@/services/stock-units.cjs';
import {
  getPrintableStockTransferChallan, printStockTransferChallan,
} from '@/services/stock';
import './challan-print.css';

const copies = ['Warehouse', 'Carrier', 'Outlet'];
const formatDate = (value) => new Intl.DateTimeFormat('en-BD', {
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));
const money = (value) => (Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2);

function ChallanCopy({ challan, copy, isReprint }) {
  return (
    <article className="challan-copy">
      <header className="challan-copy-header">
        <div className="challan-company">
          <img src="/logo.png" alt="PureBazar logo" />
          <div>
            <h1 className="challan-title">PureBazar</h1>
            <p className="mt-1 text-sm font-semibold">Transfer Challan</p>
            <p className="mt-1 text-xs text-slate-500">{copy} Copy</p>
          </div>
        </div>
        {isReprint && <span className="challan-reprint">REPRINT</span>}
      </header>

      <dl className="challan-meta">
        <div><dt>Challan / Transfer number</dt><dd>{challan.challanNumber}</dd></div>
        <div><dt>Dispatch date and time</dt><dd>{formatDate(challan.date)}</dd></div>
        <div><dt>From</dt><dd>{challan.fromLocationName || challan.fromWarehouseId}</dd></div>
        <div><dt>To</dt><dd>{challan.toLocationName || challan.toWarehouseId}</dd></div>
        <div><dt>Dispatched by</dt><dd>{challan.dispatchedByName || challan.dispatchedBy || '—'}</dd></div>
      </dl>

      <section className="challan-carrier" aria-label="Carrier details">
        <div><dt className="text-xs text-slate-500">Carrier name</dt><dd className="mt-1 font-semibold">{challan.carrierName || '—'}</dd></div>
        <div><dt className="text-xs text-slate-500">Carrier phone</dt><dd className="mt-1 font-semibold">{challan.carrierPhone || '—'}</dd></div>
        {challan.vehicle && <div><dt className="text-xs text-slate-500">Vehicle</dt><dd className="mt-1">{challan.vehicle}</dd></div>}
        {challan.notes && <div><dt className="text-xs text-slate-500">Notes</dt><dd className="mt-1">{challan.notes}</dd></div>}
      </section>

      <table className="challan-table">
        <thead>
          <tr>
            <th>Product name</th>
            <th>Barcode</th>
            <th>Unit</th>
            <th className="number">Quantity (Box + Pcs)</th>
            <th className="number">Received qty</th>
            {challan.showPricesOnChallan && <th className="number">Price (BDT)</th>}
          </tr>
        </thead>
        <tbody>
          {challan.lines.map((line) => (
            <tr key={line.productId}>
              <td>{line.productName}</td>
              <td>{line.barcode || '—'}</td>
              <td>{line.unit}</td>
              <td className="number">
                {line.isWeightBased
                  ? formatStockDisplay(line.quantity, line.unit)
                  : `${line.boxQuantity} Box + ${line.pieceQuantity} Pcs`}
              </td>
              <td className="number">&nbsp;</td>
              {challan.showPricesOnChallan && <td className="number">{line.price == null ? '—' : money(line.price)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="challan-totals text-sm">
        <strong>Lines: {challan.totalLines}</strong>
        <strong>Total pieces: {challan.totalPieces}</strong>
      </div>
      <div className="challan-barcode-wrap">
        <Code128BarcodeGraphic value={challan.challanNumber} />
        <p className="mt-1 text-xs font-semibold">{challan.challanNumber}</p>
      </div>

      <footer className="challan-signatures">
        {['Dispatcher', 'Carrier', 'Receiver'].map((role) => (
          <div className="challan-signature" key={role}>{role} signature</div>
        ))}
      </footer>
    </article>
  );
}

export default function TransferChallanPage() {
  const { id } = useParams();
  const { token, user, initialized } = useSelector((state) => state.auth);
  const canRead = user?.permissions?.includes('*') || user?.permissions?.includes('stock:transfer:read');
  const [challan, setChallan] = useState(null);
  const [isReprint, setIsReprint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [printPending, setPrintPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initialized) return undefined;
    if (!token || !canRead) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    getPrintableStockTransferChallan(token, id)
      .then((response) => active && setChallan(response.data.challan))
      .catch((requestError) => active && setError(
        requestError.response?.data?.message || 'Unable to load this transfer challan.',
      ))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [canRead, id, initialized, token]);

  useEffect(() => {
    if (!printPending) return;
    setPrintPending(false);
    window.print();
  }, [printPending]);

  async function printChallan() {
    setPrinting(true);
    setError('');
    try {
      const { data } = await printStockTransferChallan(token, id);
      setChallan(data.challan);
      setIsReprint(data.isReprint);
      setPrintPending(true);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to print this transfer challan.');
    } finally {
      setPrinting(false);
    }
  }

  if (!initialized || loading) return <p role="status" className="py-10 text-center text-sm text-slate-500">Loading transfer challan...</p>;
  if (!token || !canRead) return <p role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">You do not have permission to view transfer challans.</p>;
  if (error && !challan) return <p role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>;
  if (!challan) return <p role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Transfer challan not found.</p>;

  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <div className="challan-actions flex flex-wrap items-center justify-between gap-3">
        <Link href="/inventory/transfers" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft size={16} /> Back to transfers
        </Link>
        <div className="flex items-center gap-3">
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <Button onClick={printChallan} disabled={printing}>
            <Printer size={16} /> {printing ? 'Preparing...' : 'Print challan'}
          </Button>
        </div>
      </div>
      <div id="transfer-challan-print" className="challan-preview">
        {copies.map((copy) => (
          <ChallanCopy key={copy} challan={challan} copy={copy} isReprint={isReprint} />
        ))}
      </div>
    </section>
  );
}
