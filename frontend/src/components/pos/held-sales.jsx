'use client';

import { useCallback, useEffect, useState } from 'react';
import { PauseCircle } from 'lucide-react';
import Modal from '@/components/ui/modal';
import Button from '@/components/ui/button';
import { lineTotal } from '@/services/pos-cart-utils.cjs';
import { T } from '@/i18n/language-provider';

const STORAGE_KEY = 'purebazar.pos.heldSales';
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function readStore() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useHeldSales() {
  const [held, setHeld] = useState([]);
  useEffect(() => { setHeld(readStore()); }, []);

  const persist = useCallback((next) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setHeld(next);
  }, []);

  const hold = useCallback((sale) => {
    const entry = { ...sale, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, heldAt: new Date().toISOString() };
    persist([entry, ...readStore()]);
  }, [persist]);

  const remove = useCallback((id) => persist(readStore().filter((s) => s.id !== id)), [persist]);
  return { held, hold, remove };
}

export function estimateTotal(items) {
  return round2(items.reduce((sum, i) => sum + lineTotal(i), 0));
}

export function HeldBillsButton({ count, onClick }) {
  return (
    <button type="button" onClick={onClick} className="relative inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">
      <PauseCircle size={16} aria-hidden="true" /> Held Bills
      <span aria-label={`${count} held bills`} className="rounded-full bg-amber-500 px-2 text-xs font-semibold text-white">{count}</span>
    </button>
  );
}

export function HeldBillsModal({ held, onRestore, onDiscard, onClose }) {
  const [confirmId, setConfirmId] = useState(null);
  return (
    <Modal open onClose={onClose} title={`Held Bills (${held.length})`} className="max-h-[85vh] max-w-2xl">
      {held.length === 0 && <p className="py-6 text-center text-sm text-slate-500"><T>{"No held bills."}</T></p>}
      <ul className="space-y-2">
        {held.map((sale) => (
          <li key={sale.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900">{sale.note || 'No reference'}</p>
                <p className="text-xs text-slate-500">{new Date(sale.heldAt).toLocaleString()} · {sale.items.length} items · {sale.itemCount} qty</p>
              </div>
              <p className="font-semibold">৳{Number(sale.total).toFixed(2)}</p>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => onRestore(sale)}>Restore</Button>
                {confirmId === sale.id ? (
                  <button type="button" onClick={() => { onDiscard(sale.id); setConfirmId(null); }} className="rounded bg-red-700 px-3 py-1 text-white">Confirm delete</button>
                ) : (
                  <button type="button" onClick={() => setConfirmId(sale.id)} className="rounded border border-red-300 px-3 py-1 text-red-700">Discard</button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
