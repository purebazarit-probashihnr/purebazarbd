'use client';

import { useEffect, useRef, useState } from 'react';
import { Barcode, LoaderCircle, Search } from 'lucide-react';
import Input from '@/components/ui/input';
import { posErrorMessage, scanPosItem, searchPosItems } from '@/services/pos';
import useToastMessages from '@/hooks/use-toast-messages';
import CameraBarcodeScanner from '@/components/common/camera-barcode-scanner';
import { productLabel, stockText } from '@/services/stock-units.cjs';

export default function ItemScanner({
  onAdd, selectedOutletId, offline = false, catalog = [],
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useToastMessages({ error });
  const busy = useRef(false);
  const searchId = useRef(0);

  function localMatches(value) {
    const term = value.trim().toLocaleLowerCase();
    const exact = catalog.filter((item) => [item.barcode, ...(item.barcodes || [])]
      .some((barcode) => String(barcode || '').toLocaleLowerCase() === term));
    const matches = exact.length ? exact : catalog.filter((item) => (
      [item.name, item.barcode, item.sku, ...(item.barcodes || [])]
        .some((field) => String(field || '').toLocaleLowerCase().includes(term))
    ));
    return matches.map((item) => ({
      ...item,
      vendorMatches: exact.length > 1 ? exact : item.vendorMatches,
    }));
  }

  function reset() {
    searchId.current += 1;
    setQuery('');
    setResults([]);
    setOpen(false);
    document.getElementById('pos-barcode')?.focus();
  }

  async function submitValue(value) {
    if (!value || busy.current) return;
    if (offline) {
      setError('');
      const matches = localMatches(value);
      if (!matches.length) {
        setError('No matching product is available in the saved offline catalog.');
        return;
      }
      onAdd(matches[0]);
      reset();
      return;
    }
    busy.current = true;
    setLoading(true);
    setError('');
    try {
      const { data } = await scanPosItem(value, selectedOutletId);
      onAdd(data.item);
      reset();
    } catch (requestError) {
      if (requestError.response?.status === 404 && results.length) {
        onAdd(results[0]);
        reset();
      } else {
        setError(posErrorMessage(requestError));
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  // Enter submits an exact barcode scan; falls back to the first search match.
  async function submit(event) {
    event.preventDefault();
    await submitValue(query.trim());
  }

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      setResults([]);
      return undefined;
    }
    const id = ++searchId.current;
    if (offline) {
      setResults(localMatches(value));
      setOpen(true);
      return () => { searchId.current += 1; };
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await searchPosItems(value, selectedOutletId);
        if (id === searchId.current) {
          setResults(data.items);
          setOpen(true);
        }
      } catch {
        if (id === searchId.current) setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [catalog, offline, query, selectedOutletId]);

  function choose(item) {
    onAdd(item);
    setError('');
    reset();
  }

  return (
    <section className="relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <form onSubmit={submit}>
        <div className="flex items-end gap-2">
          <Input
            className="min-w-0 flex-1"
            label="Scan barcode or search by name, SKU or barcode"
            name="pos-barcode"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
            onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
            placeholder="Scan barcode and press Enter, or type to search"
            autoComplete="off"
            autoFocus
          />
          <CameraBarcodeScanner onScan={submitValue} disabled={loading} />
        </div>
      </form>
      {loading && <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><LoaderCircle size={13} className="animate-spin" /> Looking up...</p>}
      {open && results.length > 0 && (
        <ul role="listbox" className="absolute left-4 right-4 z-20 mt-1 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((item) => (
            <li key={item.productId} role="option" aria-selected="false">
              <button
                type="button"
                onClick={() => choose(item)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-900">{productLabel(item)}</span>
                  <span className="flex items-center gap-1 text-xs text-slate-500"><Barcode size={12} /> {item.barcode} {item.vendorName ? `· ${item.vendorName}` : ''}</span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className="block font-semibold text-slate-900">৳{Number(item.mrp).toFixed(2)}</span>
                  <span className={item.stock > 0 ? 'text-emerald-700' : 'font-semibold text-red-700'}>
                    {item.stock > 0 ? `${stockText(item.stock, item)} in stock` : 'Stock out'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
        <Search size={13} /> {offline
          ? 'Searching the saved outlet catalog. Offline sales can exceed cached stock.'
          : 'Each scan adds one; quantity is capped at available stock.'}
      </p>
    </section>
  );
}
