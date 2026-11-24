'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import CameraBarcodeScanner from '@/components/common/camera-barcode-scanner';
import useBarcodeScanner from '@/hooks/use-barcode-scanner';
import { getProductBarcodeMatches } from '@/services/inventory';
import {
  barcodeSourceForEntry, findInternalBarcodeConflict, retailBarcodeWarning,
} from '@/services/barcodeEngine';

export default function ProductBarcodeFields({
  barcode, barcodes, onChange, token, productId, productGroupId,
  onConflictChange, onOpenExisting, onAddVendor,
}) {
  const [matches, setMatches] = useState([]);
  const [lookupError, setLookupError] = useState('');
  const warning = retailBarcodeWarning(barcode);
  const extraWarnings = String(barcodes).split(/\r?\n|,/)
    .map((value) => retailBarcodeWarning(value))
    .filter(Boolean);

  useEffect(() => {
    const values = [...new Set([
      barcode,
      ...String(barcodes || '').split(/\r?\n|,/),
    ].map((value) => String(value || '').trim()).filter(Boolean))];
    setMatches([]);
    setLookupError('');
    onConflictChange?.(false);
    if (!values.length) return undefined;
    let active = true;
    const timeout = setTimeout(async () => {
      try {
        const responses = await Promise.all(values.map((value) => getProductBarcodeMatches(token, value)));
        if (active) {
          const products = responses.flatMap(({ data }) => data.products || []);
          setMatches(products.filter((product, index) => (
            product.id !== productId && products.findIndex((entry) => entry.id === product.id) === index
          )));
        }
      } catch (error) {
        if (active) {
          setMatches([]);
          setLookupError(error.response?.data?.message || 'Unable to check whether this barcode is already used.');
        }
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [barcode, barcodes, onConflictChange, productId, token]);

  const internalConflict = findInternalBarcodeConflict(matches, productGroupId || productId, productId);

  useEffect(() => {
    onConflictChange?.(Boolean(internalConflict));
  }, [internalConflict, onConflictChange]);

  const handleScan = useCallback(async (value) => {
    const scanned = String(value || '').trim();
    if (!scanned) return;
    onChange({
      barcode: scanned,
      barcodeSource: barcodeSourceForEntry(scanned),
    });
    onConflictChange?.(false);
    setLookupError('');
  }, [onChange, onConflictChange]);
  const scanner = useBarcodeScanner(handleScan);

  return (
    <div className="space-y-2 sm:col-span-2">
      <div className="flex items-end gap-2">
        <Input
          className="min-w-0 flex-1"
          label="Barcode"
          name="barcode"
          value={barcode}
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              barcode: value,
              barcodeSource: barcodeSourceForEntry(value),
            });
            onConflictChange?.(false);
            setMatches([]);
            setLookupError('');
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              scanner.onScan(event.currentTarget.value);
            }
          }}
          maxLength={100}
          placeholder="Scan or enter a manufacturer barcode; blank generates an internal barcode"
          autoComplete="off"
        />
        <CameraBarcodeScanner onScan={scanner.onScan} />
        <Button
          type="button"
          variant="secondary"
          className="hidden h-11 shrink-0 lg:inline-flex"
          onClick={() => document.getElementById('barcode')?.focus()}
          title="Focus for a USB barcode scanner"
        >
          <ScanLine size={16} /> Scan
        </Button>
      </div>
      {warning && <p role="status" className="text-xs text-amber-800">{warning} You can still save this code.</p>}
      {/* <label className="block text-sm font-medium text-slate-700" htmlFor="extra-barcodes">Extra barcodes</label>
      <textarea
        id="extra-barcodes"
        className="ui-input min-h-20 w-full"
        value={barcodes}
        onChange={(event) => onChange({ barcodes: event.target.value })}
        placeholder="One barcode per line (for example, box and piece codes)"
      /> */}
      {extraWarnings.map((message, index) => (
        <p key={`${index}-${message}`} role="status" className="text-xs text-amber-800">{message} This extra code can still be saved.</p>
      ))}
      {lookupError && <p role="alert" className="text-xs text-red-700">{lookupError}</p>}
      {internalConflict && (
        <p role="alert" className="text-xs text-red-700">
          This code is already the in-store code of {internalConflict.name}.
        </p>
      )}
      {matches.map((product) => (
        internalConflict ? null : (
        <div key={product.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-sm">
          <span>{product.name} · {product.vendorName || 'Company product'}</span>
          <span className="flex gap-2">
            {onOpenExisting && <Button type="button" size="sm" variant="secondary" onClick={() => onOpenExisting(product.id)}>Open it</Button>}
            {onAddVendor && <Button type="button" size="sm" onClick={() => onAddVendor(product.id)}>Add for another vendor</Button>}
          </span>
        </div>
        )
      ))}
    </div>
  );
}
