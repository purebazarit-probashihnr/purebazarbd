'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Button, Card } from '@/components/ui';
import useBarcodeScanner from '@/hooks/use-barcode-scanner';
import { approveStockAdjustment, createStockAdjustment, getLocations, getStockAdjustments, rejectStockAdjustment, searchReceiveProducts } from '@/services/stock';
import { isMultiUnit } from '@/services/stock-units.cjs';
import { invalidLine, lineQuantity } from '@/services/stock-adjustment-units.cjs';
import { T } from '@/i18n/language-provider';
import StockAdjustmentsRegister from './stock-adjustments-register';
import StockAdjustmentLine from './stock-adjustment-line';
import StockAdjustmentProductPicker from './stock-adjustment-product-picker';
import StockAdjustmentFields from './stock-adjustment-fields';
import useToastMessages from '@/hooks/use-toast-messages';

const can = (permissions, permission) => permissions.includes('*') || permissions.includes(permission);
const recordId = (record) => String(record.id || record._id);


export default function StockAdjustmentsPage() {
  const { token, user, initialized } = useSelector((state) => state.auth);
  const permissions = user?.permissions || [];
  const canRead = can(permissions, 'stock:read');
  const canWrite = can(permissions, 'stock:write');
  const canReadProducts = can(permissions, 'products:read');
  const isSuperAdmin = user?.role === 'Super Admin';
  const canSelectRegisterLocation = isSuperAdmin || Boolean(user?.canViewAllLocations);
  const assignedLocationId = String(user?.locationId?._id || user?.locationId || '');
  const [adjustments, setAdjustments] = useState([]);
  const [locations, setLocations] = useState([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [selectedOutletId, setSelectedOutletId] = useState('all');
  const [products, setProducts] = useState([]);
  const [matches, setMatches] = useState([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [mode, setMode] = useState('REMOVE');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [lines, setLines] = useState([]);
  const [reason, setReason] = useState('');
  const [reasonNote, setReasonNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useToastMessages({ success: notice, error });

  useEffect(() => {
    if (!initialized) return undefined;
    if (!token || !canRead) {
      setLoading(false);
      return undefined;
    }
    let active = true;
    getLocations(token)
      .then((locationResponse) => {
        if (!active) return;
        const availableLocations = locationResponse.data.locations.filter((item) => (
          item.isActive !== false && (canSelectRegisterLocation || item.id === assignedLocationId)
        ));
        setLocations(availableLocations);
        const defaultLocation = isSuperAdmin
          ? availableLocations.find((item) => item.type === 'CENTRAL') || availableLocations[0]
          : availableLocations.find((item) => item.id === assignedLocationId);
        setWarehouseId(defaultLocation?.id || '');
        setSelectedOutletId((current) => canSelectRegisterLocation ? current || 'all' : assignedLocationId);
        setLocationsLoaded(true);
      })
      .catch((requestError) => active && setError(requestError.response?.data?.message || 'Unable to load stock adjustments.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [assignedLocationId, canRead, canSelectRegisterLocation, initialized, isSuperAdmin, token]);

  useEffect(() => {
    if (!initialized || !token || !canRead || !locationsLoaded) return undefined;
    let active = true;
    setLoading(true);
    const params = canSelectRegisterLocation && selectedOutletId !== 'all'
      ? { selectedOutletId }
      : undefined;
    getStockAdjustments(token, params)
      .then((response) => active && setAdjustments(response.data.stockAdjustments))
      .catch((requestError) => active && setError(requestError.response?.data?.message || 'Unable to load stock adjustments.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [canRead, canSelectRegisterLocation, initialized, locationsLoaded, selectedOutletId, token]);

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const reasonMismatch = (
    (['Damaged', 'Expired', 'Lost or stolen'].includes(reason) && mode !== 'REMOVE')
    || (reason === 'Found extra stock' && mode !== 'ADD')
  );
  const overStockLines = lines.filter((line) => (
    mode === 'REMOVE' && lineQuantity(line) > Number(line.stockQuantity)
  ));

  useEffect(() => {
    const query = search.trim();
    if (!token || !warehouseId || !canReadProducts || !query) {
      setMatches([]);
      setSearching(false);
      setSearchError('');
      return undefined;
    }
    setMatches([]);
    setSearchError('');
    let active = true;
    const timeout = setTimeout(() => {
      setSearching(true);
      searchReceiveProducts(token, { warehouseId, mode, q: query, limit: 10 })
        .then((response) => active && setMatches(response.data.products))
        .catch((requestError) => active && setSearchError(
          requestError.response?.data?.message || 'Unable to search products.',
        ))
        .finally(() => active && setSearching(false));
    }, 300);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [canReadProducts, mode, search, token, warehouseId]);

  const addProduct = useCallback((product) => {
    setProducts((current) => current.some((item) => item.id === product.id)
      ? current : [...current, product]);
    setLines((current) => current.some((line) => line.productId === product.id)
      ? current : [...current, {
        productId: product.id,
        unitsPerPackage: product.unitsPerPackage || 1,
        packageUnitName: product.packageUnitName,
        isWeightBased: product.isWeightBased,
        quantity: '1',
        boxes: '0',
        pieces: '0',
        kg: '0',
        stockQuantity: Number(product.stockQuantity) || 0,
      }]);
    setSearch('');
    setMatches([]);
    setSearchError('');
  }, []);
  const updateLine = (productId, field, value) => setLines((current) => current.map((line) => (
    line.productId === productId ? { ...line, [field]: value } : line
  )));

  const scanBarcode = useCallback(async (barcode) => {
    if (!token || !warehouseId || !canReadProducts) {
      setError('Choose a location and ensure you have product read permission before scanning.');
      return;
    }
    setError('');
    setNotice('');
    try {
      const response = await searchReceiveProducts(token, {
        warehouseId, mode, q: barcode, limit: 10,
      });
      const product = response.data.products.find((item) => item.barcode === barcode || (item.barcodes || []).includes(barcode));
      if (!product) {
        setError(`No eligible product matches barcode ${barcode}.`);
        return;
      }
      addProduct(product);
      setNotice(`${product.name} added to this adjustment.`);
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to search for the scanned product.');
    }
  }, [addProduct, canReadProducts, mode, token, warehouseId]);
  const scanner = useBarcodeScanner(scanBarcode);

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!warehouseId || !reason || (reason === 'Other' && !reasonNote.trim())
      || !lines.length || lines.some(invalidLine)) {
      setError('Choose a location and reason, add a valid note for Other, and enter a positive quantity for each product.');
      return;
    }
    if (reasonMismatch) {
      setError('Choose a reason that matches the selected adjustment mode.');
      return;
    }
    if (overStockLines.length) {
      setError('Cannot remove more stock than is currently available at this location.');
      return;
    }
    setSaving(true);
    try {
      const response = await createStockAdjustment(token, {
        warehouseId,
        mode,
        reason,
        ...(reason === 'Other' ? { reasonNote: reasonNote.trim() } : {}),
        lines: lines.map((line) => ({ productId: line.productId, quantity: lineQuantity(line) })),
      });
      setAdjustments((current) => [response.data.stockAdjustment, ...current]);
      setLines([]);
      setReason('');
      setReasonNote('');
      setNotice(response.data.stockAdjustment.status === 'Pending'
        ? 'Adjustment submitted and awaiting Super Admin approval.'
        : 'Stock adjustment approved and posted.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to create the stock adjustment.');
    } finally {
      setSaving(false);
    }
  }

  async function runDecision(item, approve) {
    setError('');
    setNotice('');
    try {
      const response = approve
        ? await approveStockAdjustment(token, recordId(item))
        : await rejectStockAdjustment(token, recordId(item));
      const updated = response.data.stockAdjustment;
      setAdjustments((current) => current.map((entry) => recordId(entry) === recordId(updated) ? updated : entry));
      setNotice(approve ? 'Adjustment approved and posted.' : 'Adjustment rejected.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update the stock adjustment.');
    }
  }

  if (!initialized || loading) return <p role="status" className="py-10 text-center text-sm text-slate-500"><T>{"Loading stock adjustments..."}</T></p>;
  if (!token || !canRead) return <p role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><T>{"You do not have permission to view stock adjustments."}</T></p>;

  return (
    <section className="space-y-5">
      <header>
        <p className="mb-1 text-xs font-semibold uppercase text-slate-500"><T>{"Inventory"}</T></p>
        <h1 className="text-2xl font-semibold text-slate-900"><T>{"Stock Adjustment"}</T></h1>
        <p className="mt-1 text-sm text-slate-600"><T>{"Record corrections, damage, or other approved stock changes."}</T></p>
      </header>

      {canWrite && (
        <Card title="New adjustment" description="Enter positive quantities; the selected mode determines whether stock is added or removed.">
          <form className="space-y-4" onSubmit={submit}>
            <StockAdjustmentFields
              isSuperAdmin={isSuperAdmin}
              user={user}
              locations={locations}
              warehouseId={warehouseId}
              onLocationChange={(event) => {
                setWarehouseId(event.target.value);
                setLines([]);
                setSearch('');
                setMatches([]);
              }}
              mode={mode}
              onModeChange={(event) => setMode(event.target.value)}
              reason={reason}
              onReasonChange={(event) => setReason(event.target.value)}
              reasonNote={reasonNote}
              onReasonNoteChange={(event) => setReasonNote(event.target.value)}
            />
            {reasonMismatch && <p role="alert" className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{reason} is not allowed in {mode === 'REMOVE' ? 'Remove stock' : 'Add stock'} mode.</p>}
            {!can(permissions, 'products:read') && <p className="text-sm text-amber-700"><T>{"Product read permission is required to select adjustment lines."}</T></p>}
            <StockAdjustmentProductPicker
              warehouseId={warehouseId}
              canReadProducts={can(permissions, 'products:read')}
              scanner={scanner}
              onScan={scanBarcode}
              search={search}
              onSearchChange={setSearch}
              searching={searching}
              searchError={searchError}
              matches={matches}
              onAddProduct={addProduct}
            />
            {lines.map((line) => (
              <StockAdjustmentLine
                key={line.productId}
                line={line}
                product={productsById.get(line.productId)}
                mode={mode}
                onChange={updateLine}
                onRemove={() => setLines((current) => current.filter((entry) => entry.productId !== line.productId))}
              />
            ))}
            <div className="flex justify-end"><Button type="submit" disabled={saving || !lines.length || reasonMismatch}>{saving ? 'Submitting...' : 'Submit adjustment'}</Button></div>
          </form>
        </Card>
      )}

      <StockAdjustmentsRegister
        adjustments={adjustments}
        locations={locations}
        productsById={productsById}
        selectedOutletId={selectedOutletId}
        canSelectLocation={canSelectRegisterLocation}
        user={user}
        onLocationChange={(event) => setSelectedOutletId(event.target.value)}
        onDecision={runDecision}
      />
    </section>
  );
}
