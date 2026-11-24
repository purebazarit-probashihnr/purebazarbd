'use client';

import Link from 'next/link';
import { ArrowDownToLine, ArrowUpFromLine, Check, Printer } from 'lucide-react';
import { Badge, Button, Card, Input } from '@/components/ui';
import {
  displayId, formatDate, qty, statusTone,
} from '@/components/inventory/stock-transfer-display';

export default function StockTransferDetail({
  transfer,
  canDispatch,
  canReceive,
  carrier,
  setCarrier,
  quantityDraft,
  setQuantityDraft,
  saving,
  onSubmit,
}) {
  return (
    <Card
      title={`Transfer ${displayId(transfer.id)}`}
      description={`${transfer.fromLocationName || 'Central warehouse'} to ${transfer.toLocationName || 'Outlet'} · ${formatDate(transfer.createdAt)}`}
      actions={<Badge tone={statusTone[transfer.status] || 'neutral'}>{transfer.status}</Badge>}
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <div className="space-y-3">
          {transfer.receivedByName && (
            <p className="text-sm text-slate-600">Confirmed by {transfer.receivedByName}</p>
          )}
          {transfer.carrierName && (
            <p className="text-sm text-slate-600">
              Carrier: {transfer.carrierName} · {transfer.carrierPhone}
              {transfer.vehicle ? ` · ${transfer.vehicle}` : ''}
            </p>
          )}
          {transfer.status === 'Requested' && canDispatch && (
            <div className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
              <Input
                label="Carrier name"
                required
                value={carrier.name}
                onChange={(event) => setCarrier((current) => ({ ...current, name: event.target.value }))}
              />
              <Input
                label="Carrier phone"
                type="tel"
                required
                value={carrier.phone}
                onChange={(event) => setCarrier((current) => ({ ...current, phone: event.target.value }))}
              />
              <Input
                label="Vehicle (optional)"
                value={carrier.vehicle}
                onChange={(event) => setCarrier((current) => ({ ...current, vehicle: event.target.value }))}
              />
              <Input
                label="Notes (optional)"
                value={carrier.notes}
                onChange={(event) => setCarrier((current) => ({ ...current, notes: event.target.value }))}
              />
            </div>
          )}
          {transfer.lines.map((line) => {
            const editable = (transfer.status === 'Requested' && canDispatch)
              || (transfer.status === 'Dispatched' && canReceive);
            const quantityName = transfer.status === 'Requested' ? 'Dispatch quantity' : 'Received quantity';
            const currentQuantity = transfer.status === 'Requested'
              ? line.dispatchedQuantity
              : line.receivedQuantity;
            const initialQuantity = transfer.status === 'Requested'
              ? line.requestedQuantity
              : line.dispatchedQuantity;
            return (
              <div key={line.productId} className="grid items-center gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_repeat(3,minmax(5rem,auto))]">
                <div><strong className="block text-sm text-slate-800">{line.productName || displayId(line.productId)}</strong><small className="text-slate-500">{line.barcode || line.productId}</small></div>
                <span className="text-sm text-slate-600">Requested: {qty(line.requestedQuantity, line)}</span>
                {transfer.status !== 'Requested' && <span className="text-sm text-slate-600">Dispatched: {qty(line.dispatchedQuantity, line)}</span>}
                {editable ? (
                  <div>
                    <Input label={line.isWeightBased ? `${quantityName} (Gram)` : quantityName} type="number" min="0" step="any" value={quantityDraft[line.productId] ?? currentQuantity ?? initialQuantity} onChange={(event) => setQuantityDraft((current) => ({ ...current, [line.productId]: event.target.value }))} />
                    {line.isWeightBased && <small className="text-slate-500">= {qty(quantityDraft[line.productId] ?? currentQuantity ?? initialQuantity, line)}</small>}
                  </div>
                ) : transfer.status === 'Received' || transfer.status === 'Discrepancy' ? (
                  <span className="text-sm text-slate-600">Received: {qty(line.receivedQuantity, line)}</span>
                ) : null}
                {line.discrepancyQuantity > 0 && <span className="text-sm font-medium text-red-700">Difference: {qty(line.discrepancyQuantity, line)}</span>}
              </div>
            );
          })}
        </div>
        {transfer.status === 'Requested' && canDispatch && (
          <div className="flex justify-end"><Button type="submit" disabled={saving}><ArrowUpFromLine size={16} /> {saving ? 'Dispatching...' : 'Dispatch transfer'}</Button></div>
        )}
        {transfer.status === 'Dispatched' && canReceive && (
          <div className="flex justify-end"><Button type="submit" disabled={saving}><ArrowDownToLine size={16} /> {saving ? 'Confirming...' : 'Confirm outlet receipt'}</Button></div>
        )}
        {!((transfer.status === 'Requested' && canDispatch) || (transfer.status === 'Dispatched' && canReceive)) && (
          <p className="text-sm text-slate-500"><Check size={15} className="mr-1 inline" /> This transfer is read-only for your role or has completed its available action.</p>
        )}
      </form>
      {transfer.status !== 'Requested' && (
        <div className="mt-4 flex justify-end">
          <Link
            href={`/inventory/stock-transfers/${transfer.id}/challan`}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            <Printer size={16} /> Print challan
          </Link>
        </div>
      )}
    </Card>
  );
}
