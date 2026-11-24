'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Badge, Button, Card, Select, Table } from '@/components/ui';
import StockTransferRequestForm from '@/components/inventory/stock-transfer-request-form';
import StockTransferDetail from '@/components/inventory/stock-transfer-detail';
import TransferChallanScanner from '@/components/inventory/transfer-challan-scanner';
import LocationReadFilter from '@/components/common/location-read-filter';
import {
  createStockTransfer, dispatchStockTransfer, getLocations, getStockTransfers, receiveStockTransfer,
} from '@/services/stock';
import { T } from '@/i18n/language-provider';
import useToastMessages from '@/hooks/use-toast-messages';
import {
  displayId, formatDate, statusTone, statuses,
} from '@/components/inventory/stock-transfer-display';

const can = (permissions, permission) => permissions.includes('*') || permissions.includes(permission);

export default function StockTransfersPage() {
  const { token, user, initialized } = useSelector((state) => state.auth);
  const permissions = user?.permissions || [];
  const canRead = can(permissions, 'stock:transfer:read');
  const canWrite = can(permissions, 'stock:transfer:write');
  const canReceive = can(permissions, 'stock:transfer:receive');
  const isSuperAdmin = user?.role === 'Super Admin';
  const canSelectRegisterLocation = isSuperAdmin || Boolean(user?.canViewAllLocations);
  const assignedLocationId = String(user?.locationId?._id || user?.locationId || '');
  const canChooseSource = isSuperAdmin;
  const canRequestTransfer = isSuperAdmin || user?.location?.type === 'CENTRAL';
  const [transfers, setTransfers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [locationsLoaded, setLocationsLoaded] = useState(false);
  const [sourceId, setSourceId] = useState('');
  const [outletId, setOutletId] = useState('');
  const [selectedOutletId, setSelectedOutletId] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [quantityDraft, setQuantityDraft] = useState({});
  const [carrier, setCarrier] = useState({ name: '', phone: '', vehicle: '', notes: '' });
  const [statusFilter, setStatusFilter] = useState('');
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
        const availableLocations = locationResponse.data.locations.filter((location) => location.isActive !== false);
        setLocations(availableLocations);
        const assigned = availableLocations.find(({ id }) => id === assignedLocationId);
        setSourceId(isSuperAdmin
          ? availableLocations.find(({ type }) => type === 'CENTRAL')?.id || ''
          : assigned?.type === 'CENTRAL' ? assigned.id : '');
        setOutletId(availableLocations.find(({ type, isActive }) => type === 'OUTLET' && isActive !== false)?.id || '');
        setSelectedOutletId((current) => canSelectRegisterLocation ? current || 'all' : assignedLocationId);
        setLocationsLoaded(true);
      })
      .catch((requestError) => active && setError(
        requestError.response?.data?.message || 'Unable to load outlet transfers.',
      ))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [assignedLocationId, canRead, canSelectRegisterLocation, initialized, isSuperAdmin, token]);

  useEffect(() => {
    if (!initialized || !token || !canRead || !locationsLoaded) return undefined;
    let active = true;
    setLoading(true);
    getStockTransfers(token, canSelectRegisterLocation ? selectedOutletId : undefined)
      .then((response) => active && setTransfers(response.data.stockTransfers))
      .catch((requestError) => active && setError(
        requestError.response?.data?.message || 'Unable to load outlet transfers.',
      ))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [canRead, canSelectRegisterLocation, initialized, locationsLoaded, selectedOutletId, token]);
  const locationsById = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);
  const visibleTransfers = useMemo(() => transfers.filter((transfer) => (
    !statusFilter || transfer.status === statusFilter
  )), [statusFilter, transfers]);
  const selectedTransfer = transfers.find(({ id }) => id === selectedId);
  const sourceLocations = locations.filter(({ type }) => type === 'CENTRAL');
  const outletLocations = locations.filter(({ type, isActive }) => type === 'OUTLET' && isActive !== false);
  const canDispatchSelected = Boolean(selectedTransfer && canWrite && (
    isSuperAdmin || assignedLocationId === selectedTransfer.fromWarehouseId
  ));
  const canReceiveSelected = Boolean(selectedTransfer && canReceive && (
    isSuperAdmin
    || (user?.canViewAllLocations && can(permissions, 'stock:transfer:receive'))
    || assignedLocationId === selectedTransfer.toWarehouseId
  ));

  function selectTransfer(transfer) {
    setSelectedId(transfer.id);
    setQuantityDraft({});
    setCarrier({
      name: transfer.carrierName || '',
      phone: transfer.carrierPhone || '',
      vehicle: transfer.vehicle || '',
      notes: transfer.notes || '',
    });
    setError('');
    setNotice('');
  }

  async function submitRequest(requestLines) {
    if (!sourceId || !outletId || !requestLines.length) {
      setError('Select a source warehouse, an outlet, and at least one product.');
      return false;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await createStockTransfer(token, {
        fromWarehouseId: sourceId,
        toWarehouseId: outletId,
        lines: requestLines.map((line) => ({
          productId: line.productId,
          requestedQuantity: Number(line.requestedQuantity),
        })),
      });
      setTransfers((current) => [response.data.stockTransfer, ...current]);
      setSelectedId(response.data.stockTransfer.id);
      setNotice('Transfer request created.');
      return true;
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to create the transfer request.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitWorkflow(event) {
    event.preventDefault();
    if (!selectedTransfer) return;
    const isDispatch = selectedTransfer.status === 'Requested';
    if (isDispatch && (!carrier.name.trim() || !carrier.phone.trim())) {
      setError('Enter the carrier name and phone before dispatching.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    const quantityField = isDispatch ? 'dispatchedQuantity' : 'receivedQuantity';
    const lines = selectedTransfer.lines.map((line) => ({
      productId: line.productId,
      [quantityField]: Number(quantityDraft[line.productId]
        ?? (isDispatch ? line.requestedQuantity : line.dispatchedQuantity)),
    }));
    try {
      const action = isDispatch ? dispatchStockTransfer : receiveStockTransfer;
      const payload = { lines };
      if (isDispatch) {
        payload.carrierName = carrier.name.trim();
        payload.carrierPhone = carrier.phone.trim();
        payload.vehicle = carrier.vehicle.trim();
        payload.notes = carrier.notes.trim();
      }
      const response = await action(token, selectedTransfer.id, payload);
      const updatedTransfer = response.data.stockTransfer;
      setTransfers((current) => current.map((transfer) => (
        transfer.id === updatedTransfer.id ? updatedTransfer : transfer
      )));
      setQuantityDraft({});
      setNotice(isDispatch ? 'Transfer dispatched to the outlet.' : 'Outlet receipt confirmed.');
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update this transfer.');
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    {
      key: 'id',
      label: 'Transfer / Date',
      render: (id, transfer) => (
        <div><strong className="block text-slate-800">{displayId(id)}</strong><small className="text-slate-500">{formatDate(transfer.createdAt)}</small></div>
      ),
    },
    { key: 'fromWarehouseId', label: 'From', render: (id) => locationsById.get(id) || 'Central warehouse' },
    { key: 'toWarehouseId', label: 'Outlet', render: (id) => locationsById.get(id) || 'Outlet' },
    { key: 'lines', label: 'Products', render: (lines) => lines.length },
    { key: 'status', label: 'Status', render: (status) => <Badge tone={statusTone[status] || 'neutral'}>{status}</Badge> },
    {
      key: 'actions',
      label: 'Actions',
      render: (_, transfer) => (
        <Button size="sm" variant={selectedId === transfer.id ? 'secondary' : 'ghost'} onClick={() => selectTransfer(transfer)}>
          {selectedId === transfer.id ? 'Selected' : 'View'}
        </Button>
      ),
    },
  ];

  if (!initialized || loading) return <p role="status" className="py-10 text-center text-sm text-slate-500"><T>{"Loading outlet transfers..."}</T></p>;
  if (!token || !canRead) return <p role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><T>{"You do not have permission to view outlet transfers."}</T></p>;

  return (
    <section className="space-y-5">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-slate-500"><T>{"Inventory"}</T></p>
        <h1 className="text-2xl font-semibold text-slate-900"><T>{"Outlet Transfers"}</T></h1>
        <p className="mt-1 text-sm text-slate-600"><T>{"Request stock, dispatch from the central warehouse, and confirm outlet deliveries."}</T></p>
      </div>

      {canWrite && canRequestTransfer && (
        <StockTransferRequestForm
          token={token}
          permissions={permissions}
          canChooseSource={canChooseSource}
          sourceLocations={sourceLocations}
          locationName={user?.location?.name}
          outletLocations={outletLocations}
          sourceId={sourceId}
          setSourceId={setSourceId}
          outletId={outletId}
          setOutletId={setOutletId}
          saving={saving}
          setError={setError}
          onSubmitRequest={submitRequest}
        />
      )}

      <Card title="Transfer register" description={`${transfers.length} transfer${transfers.length === 1 ? '' : 's'} ${canSelectRegisterLocation && selectedOutletId === 'all' ? 'across all locations' : 'in your location scope'}`}>
        <TransferChallanScanner transfers={transfers} onSelect={selectTransfer} onError={setError} />
        <div className="mb-4">
          <LocationReadFilter
            locations={locations}
            selectedOutletId={selectedOutletId}
            onChange={(event) => setSelectedOutletId(event.target.value)}
            canSelectLocation={canSelectRegisterLocation}
            locationName={user?.location?.name}
          />
        </div>
        <div className="mb-4 max-w-xs">
          <Select label="Filter by status" name="statusFilter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value=""><T>{"All statuses"}</T></option>
            {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </Select>
        </div>
        <Table columns={columns} rows={visibleTransfers} rowKey="id" emptyMessage={statusFilter ? `No ${statusFilter.toLowerCase()} transfers.` : 'No outlet transfers yet.'} />
      </Card>

      {selectedTransfer && (
        <StockTransferDetail
          transfer={selectedTransfer}
          canDispatch={canDispatchSelected}
          canReceive={canReceiveSelected}
          carrier={carrier}
          setCarrier={setCarrier}
          quantityDraft={quantityDraft}
          setQuantityDraft={setQuantityDraft}
          saving={saving}
          onSubmit={submitWorkflow}
        />
      )}
    </section>
  );
}
