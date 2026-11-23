'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select } from '@/components/ui';
import { getBrands, getCategories, getUnits } from '@/services/inventory';
import { T } from '@/i18n/language-provider';
import ProductBarcodeFields from './product-barcode-fields';

const hasPermission = (permissions, permission) => (
  permissions.includes('*') || permissions.includes(permission)
);
const roundedMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const idOf = (value) => value?._id?.toString() || value?.toString() || '';

function formFor(product) {
  return {
    name: product?.name || '',
    categoryId: idOf(product?.categoryId),
    brandId: idOf(product?.brandId),
    unitId: idOf(product?.unitId),
    vendorPrice: String(product?.vendorPrice ?? ''),
    mrp: String(product?.mrp ?? ''),
    vatApplicable: Boolean(product?.vatApplicable),
    vatRate: product?.vatRate == null ? '' : String(product.vatRate),
    barcode: product?.barcode || '',
    barcodes: (product?.barcodes || []).join('\n'),
    barcodeSource: product?.barcodeSource || (String(product?.barcode || '').startsWith('PB') ? 'internal' : 'manufacturer'),
  };
}

export default function ProductEditModal({
  open, onClose, onSubmit, product, token, permissions, onOpenExisting, onAddVendor,
}) {
  const [form, setForm] = useState(formFor(product));
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [units, setUnits] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogErrors, setCatalogErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [barcodeConflict, setBarcodeConflict] = useState(false);
  const permissionsKey = permissions.join('|');
  const vendorPrice = Number(form.vendorPrice);
  const mrp = Number(form.mrp);
  const hasPrices = form.vendorPrice !== '' && form.mrp !== ''
    && Number.isFinite(vendorPrice) && Number.isFinite(mrp);
  const invalidMrp = hasPrices && mrp < vendorPrice;

  useEffect(() => {
    if (!open || !product) return;
    setForm(formFor(product));
    setError('');
    setBarcodeConflict(false);
    setCatalogErrors([]);
  }, [open, product]);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    const currentPermissions = permissionsKey ? permissionsKey.split('|') : [];
    const requests = [
      ['categories', 'categories:read', getCategories],
      ['brands', 'brands:read', getBrands],
      ['units', 'units:read', getUnits],
    ];
    const unavailable = requests
      .filter(([, permission]) => !hasPermission(currentPermissions, permission))
      .map(([name]) => `You do not have permission to load ${name}.`);
    const available = requests.filter(([, permission]) => hasPermission(currentPermissions, permission));
    setCatalogLoading(true);
    Promise.allSettled(available.map(([, , load]) => load(token))).then((results) => {
      if (!active) return;
      const errors = [...unavailable];
      results.forEach((result, index) => {
        const [name] = available[index];
        if (result.status === 'rejected') {
          errors.push(result.reason.response?.data?.message || `Unable to load ${name}.`);
        } else {
          const values = result.value.data[name];
          if (name === 'categories') setCategories(values);
          if (name === 'brands') setBrands(values);
          if (name === 'units') setUnits(values);
        }
      });
      setCatalogErrors(errors);
      setCatalogLoading(false);
    });
    return () => { active = false; };
  }, [open, permissionsKey, token]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (invalidMrp) {
      setError('MRP must be greater than or equal to vendor price.');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(product.id, {
        name: form.name.trim(),
        categoryId: form.categoryId,
        brandId: form.brandId || null,
        unitId: form.unitId,
        barcode: form.barcode.trim(),
        barcodes: [...new Set(form.barcodes.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean))],
        barcodeSource: form.barcodeSource,
        vendorPrice: roundedMoney(vendorPrice),
        mrp: roundedMoney(mrp),
        vatApplicable: form.vatApplicable,
        ...(form.vatApplicable && form.vatRate !== '' ? { vatRate: Number(form.vatRate) } : {}),
      });
      onClose();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to update this product.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit product" className="product-form-modal">
      <form className="space-y-5" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Product name" name="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={150} />
          <Select label="Category" name="categoryId" value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} required>
            <option value=""><T>{"Select category"}</T></option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </Select>
          <Select label="Brand" name="brandId" value={form.brandId} onChange={(event) => setForm({ ...form, brandId: event.target.value })}>
            <option value=""><T>{"Select brand (optional)"}</T></option>
            {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
          </Select>
          <Select label="Unit" name="unitId" value={form.unitId} onChange={(event) => setForm({ ...form, unitId: event.target.value })} required>
            <option value=""><T>{"Select unit"}</T></option>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.abbreviation})</option>)}
          </Select>
          <Input label="Vendor price (৳)" name="vendorPrice" type="number" min="0" step="0.01" value={form.vendorPrice} onChange={(event) => setForm({ ...form, vendorPrice: event.target.value })} required />
          <Input label="MRP (৳)" name="mrp" type="number" min="0" step="0.01" value={form.mrp} onChange={(event) => setForm({ ...form, mrp: event.target.value })} required />
          <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" name="vatApplicable" checked={form.vatApplicable} onChange={(event) => setForm({ ...form, vatApplicable: event.target.checked })} />
            VAT applicable
          </label>
          <Input label="VAT rate (%)" name="vatRate" type="number" min="0" max="100" step="0.01" value={form.vatRate} onChange={(event) => setForm({ ...form, vatRate: event.target.value })} required={form.vatApplicable} disabled={!form.vatApplicable} />
        </div>
        <ProductBarcodeFields
          barcode={form.barcode}
          barcodes={form.barcodes}
          barcodeSource={form.barcodeSource}
          onChange={(changes) => setForm((current) => ({ ...current, ...changes }))}
          onConflictChange={setBarcodeConflict}
          token={token}
          productId={product?.id}
          productGroupId={idOf(product?.productGroupId)}
          onOpenExisting={onOpenExisting}
          onAddVendor={onAddVendor}
        />
        {catalogLoading && <p role="status" className="text-xs text-slate-500"><T>{"Loading product categories, brands, and units..."}</T></p>}
        {catalogErrors.map((message) => <p key={message} role="alert" className="text-xs text-amber-800">{message}</p>)}
        {invalidMrp && <p role="alert" className="text-xs text-red-700"><T>{"MRP must be greater than or equal to vendor price."}</T></p>}
        {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || catalogLoading || !hasPrices || invalidMrp || barcodeConflict}>{saving ? 'Saving...' : 'Save changes'}</Button>
        </div>
      </form>
    </Modal>
  );
}
