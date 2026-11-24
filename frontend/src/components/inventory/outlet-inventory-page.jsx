'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { Badge, Card, Input, Select, Table } from '@/components/ui';
import { getLocations, getOutletProducts } from '@/services/stock';
import { formatStock } from '@/services/stock-units.cjs';
import { T } from '@/i18n/language-provider';

const can = (permissions, permission) => permissions.includes('*') || permissions.includes(permission);

export default function OutletInventoryPage() {
  const { token, user, initialized } = useSelector((state) => state.auth);
  const canRead = can(user?.permissions || [], 'stock:read');
  const isSuperAdmin = user?.role === 'Super Admin';
  const canViewAllLocations = isSuperAdmin || Boolean(user?.canViewAllLocations);
  const canChooseLocation = canViewAllLocations || user?.location?.type === 'CENTRAL';
  const assignedLocationId = String(user?.locationId?._id || user?.locationId || '');
  const [locations, setLocations] = useState([]);
  const [location, setLocation] = useState(null);
  const [locationFilter, setLocationFilter] = useState('all');
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initialized) return undefined;
    if (!token || !canRead) {
      setLoading(false);
      return undefined;
    }
    setError('');
    let active = true;
    getLocations(token)
      .then((response) => {
        const available = response.data.locations.filter((item) => (
          item.isActive !== false && (canChooseLocation || item.id === assignedLocationId)
        ));
        const selected = available.find(({ id }) => id === assignedLocationId)
          || available.find(({ type }) => type === 'CENTRAL')
          || available[0];
        if (!selected) throw new Error('No active locations are available.');
        if (!active) return;
        setLocations(available);
        setLocation(selected);
      })
      .catch((requestError) => active && setError(
        requestError.response?.data?.message || requestError.message || 'Unable to load locations.',
      ))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [assignedLocationId, canChooseLocation, canRead, initialized, token]);

  useEffect(() => {
    if (!token || !location?.id) return undefined;
    let active = true;
    setError('');
    setProducts([]);
    const allLocations = location.id === 'all';
    getOutletProducts(token, allLocations ? undefined : location.id, allLocations)
      .then((response) => active && setProducts(response.data.products))
      .catch((requestError) => active && setError(
        requestError.response?.data?.message || 'Unable to load outlet inventory.',
      ));
    return () => { active = false; };
  }, [location?.id, token]);

  const allInventory = location?.id === 'all';
  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((item) => (
      (!allInventory || locationFilter === 'all' || item.locationId === locationFilter)
      && (!query || `${item.name} ${item.sku} ${item.barcode} ${(item.barcodes || []).join(' ')} ${item.vendorName || ''} ${item.vendorBrand || ''} ${item.locationName || ''}`
        .toLowerCase().includes(query))
    )).map((item) => ({
      ...item,
      rowId: `${item.locationId || location?.id}:${item.productId}`,
    }));
  }, [allInventory, location?.id, locationFilter, products, search]);
  const columns = [
    { key: 'name', label: 'Product' },
    { key: 'sku', label: 'SKU', render: (sku) => sku || '—' },
    { key: 'barcode', label: 'Barcode', render: (barcode) => barcode || '—' },
    { key: 'vendorName', label: 'Vendor', render: (name) => name ? <Badge tone="info">{name}</Badge> : '—' },
    { key: 'vendorBrand', label: 'Vendor brand', render: (brand) => brand || '—' },
    ...(allInventory ? [{ key: 'locationName', label: 'Location' }] : []),
    {
      key: 'stock',
      label: 'Stock',
      render: (stock, product) => <strong>{formatStock(stock, product.unitsPerPackage, product.packageUnitName)}</strong>,
    },
  ];

  if (!initialized || loading) return <p role="status" className="py-10 text-center text-sm text-slate-500"><T>{"Loading outlet inventory..."}</T></p>;
  if (!token || !canRead) return <p role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><T>{"You do not have permission to view inventory."}</T></p>;

  return (
    <section className="space-y-5">
      <header>
        <p className="mb-1 text-xs font-semibold uppercase text-slate-500"><T>{"Inventory"}</T></p>
        <h1 className="text-2xl font-semibold text-slate-900"><T>{"Outlet Inventory"}</T></h1>
        <p className="mt-1 text-sm text-slate-600"><T>{"Catalog products and movement-derived stock for the selected location."}</T></p>
      </header>
      {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      <div className="max-w-sm">
        {canChooseLocation ? (
          <Select
            label="Inventory location"
            name="warehouseId"
            value={location?.id || ''}
            onChange={(event) => {
              const { value } = event.target;
              setLocation(value === 'all'
                ? { id: 'all', name: 'All inventory' }
                : locations.find((item) => item.id === value) || null);
              setLocationFilter('all');
            }}
          >
            {canViewAllLocations && <option value="all">All inventory</option>}
            {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        ) : (
          <Input label="Outlet" value={location?.name || user?.location?.name || ''} readOnly />
        )}
      </div>
      <Card
        title={location?.name || 'Location'}
        description={`${products.length} ${allInventory ? 'product-location rows' : 'catalog products'}`}
      >
        <div className="mb-4 max-w-xl">
          <Input label="Search products" name="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, SKU, barcode, vendor name, or vendor brand" />
        </div>
        {allInventory && (
          <div className="mb-4 max-w-sm">
            <Select
              label="Filter by location"
              name="locationFilter"
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
            >
              <option value="all">All locations</option>
              {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </div>
        )}
        <Table columns={columns} rows={visibleProducts} rowKey="rowId" emptyMessage="No products match this search." />
      </Card>
    </section>
  );
}
