'use client';

import { useEffect, useRef, useState } from 'react';
import { basePieceCost, defaultPiecesPerPackage, totalPieces } from '@/services/unit-pieces.cjs';
import { Plus, X } from 'lucide-react';
import { formatMoney, roundHalfUp } from '@/services/money-format.cjs';
import { baseUnitName as canonicalBaseName, classifyUnit, fixedPackageSize, toBaseUnits } from '@/services/stock-units.cjs';
import { Button, Input, Modal, Select } from '@/components/ui';
import {
  createBrand, createCategory, createUnit, getBrands, getCategories, getUnits,
} from '@/services/inventory';
import QuickAddBrandModal from './quick-add-brand-modal';
import QuickAddCategoryModal from './quick-add-category-modal';
import QuickAddUnitModal from './quick-add-unit-modal';
import VendorAutocomplete from './vendor-autocomplete';
import { T } from '@/i18n/language-provider';
import useToastMessages from '@/hooks/use-toast-messages';

const emptyForm = {
  name: '',
  ownerType: 'COMPANY',
  vendorId: '',
  vendorPrice: '',
  mrp: '',
  categoryId: '',
  brandId: '',
  unitId: '',
  baseUnitId: '',
  vatApplicable: false,
  vatRate: '',
  piecesPerPackage: '',
  subUnitPriceOverride: '',
  sellingUnits: [],
};

const REQUIRES_NUMBER = ['box', 'sack', 'crate', 'tray', 'pack'];
const money = (value) => formatMoney(Number.isFinite(value) ? value : 0);
const roundedMoney = (value) => roundHalfUp(value);

export default function ProductFormModal({
  open, onClose, onSubmit, token, permissions, marginWarningPercent,
}) {
  const [form, setForm] = useState(emptyForm);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [units, setUnits] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogErrors, setCatalogErrors] = useState([]);
  const [quickAdd, setQuickAdd] = useState('');
  const piecesEdited = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useToastMessages({ error });

  const can = (permission) => permissions.includes('*') || permissions.includes(permission);
  const vendorPrice = Number(form.vendorPrice);
  const mrp = Number(form.mrp);
  const hasPrices = form.vendorPrice !== '' && form.mrp !== ''
    && Number.isFinite(vendorPrice) && Number.isFinite(mrp);
  const roundedVendorPrice = hasPrices ? roundedMoney(vendorPrice) : 0;
  const roundedMrp = hasPrices ? roundedMoney(mrp) : 0;
  const margin = hasPrices ? roundedMoney(roundedMrp - roundedVendorPrice) : null;
  const discountPercent = Number.isFinite(marginWarningPercent) ? marginWarningPercent : 5;
  const warningAmount = hasPrices ? roundedMoney(roundedMrp * discountPercent / 100) : 0;
  const marginWarning = margin !== null && margin >= 0 && margin < warningAmount;
  const invalidMrp = hasPrices && mrp < vendorPrice;
  const packageUnit = units.find((item) => item.id === form.unitId);
  const baseUnit = units.find((item) => item.id === form.baseUnitId);
  const fixedSize = packageUnit ? fixedPackageSize(packageUnit.name, packageUnit.abbreviation) : null;
  const baseNames = baseUnit ? [baseUnit.name, baseUnit.abbreviation] : [];
  const baseLabel = canonicalBaseName(classifyUnit(...baseNames).kind);
  const enteredPieces = form.piecesPerPackage === '' ? '' : toBaseUnits(form.piecesPerPackage, ...baseNames);
  const unitsPerPackage = Number(totalPieces(fixedSize || enteredPieces));
  const sellingUnits = form.sellingUnits
    .filter((row) => row.name.trim() && row.baseQuantity !== '')
    .map((row) => ({ name: row.name.trim(), baseQuantity: Number(row.baseQuantity) }));
  const invalidExtras = sellingUnits.some((row) => !Number.isInteger(row.baseQuantity) || row.baseQuantity < 1);
  const hasPieces = Number.isInteger(unitsPerPackage) && unitsPerPackage > 1 && hasPrices;
  const trueBaseCost = hasPieces ? basePieceCost(roundedMrp, unitsPerPackage) : null;
  const autoPiecePrice = hasPieces ? trueBaseCost : null;
  // Helper text depends only on MRP, quantity and pieces, so it updates on every keystroke.
  const helperPieces = unitsPerPackage;
  const helperMrp = form.mrp !== '' && Number.isFinite(mrp) ? roundedMoney(mrp) : null;
  const helperVendorCost = form.vendorPrice !== '' && Number.isInteger(helperPieces) && helperPieces > 1
    ? roundedMoney(basePieceCost(roundedMoney(vendorPrice), helperPieces)) : null;
  const helperCost = helperMrp !== null && Number.isInteger(helperPieces) && helperPieces > 1
    ? roundedMoney(basePieceCost(helperMrp, helperPieces)) : null;
  const overrideValue = form.subUnitPriceOverride === '' ? null : Number(form.subUnitPriceOverride);
  const invalidOverride = hasPieces && overrideValue !== null
    && (!Number.isFinite(overrideValue) || overrideValue < trueBaseCost - 1e-9);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setForm(emptyForm);
    piecesEdited.current = false;
    setError('');
    setCatalogErrors([]);
    setCatalogLoading(true);

    const requests = [
      ['categories', 'categories:read', getCategories],
      ['brands', 'brands:read', getBrands],
      ['units', 'units:read', getUnits],
    ];
    const unavailable = requests
      .filter(([, permission]) => !can(permission))
      .map(([name]) => `You do not have permission to load ${name}.`);
    const available = requests.filter(([, permission]) => can(permission));

    Promise.allSettled(available.map(([, , load]) => load(token))).then((results) => {
      if (!active) return;
      const errors = [...unavailable];
      results.forEach((result, index) => {
        const [name] = available[index];
        if (result.status === 'rejected') {
          errors.push(result.reason.response?.data?.message || `Unable to load ${name}.`);
          return;
        }
        const values = result.value.data[name];
        if (name === 'categories') setCategories(values);
        if (name === 'brands') setBrands(values);
        if (name === 'units') setUnits(values);
      });
      setCatalogErrors(errors);
      setCatalogLoading(false);
    });

    return () => { active = false; };
  // Permissions are refreshed with the authenticated user; reopening reloads catalog data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, token, permissions]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.ownerType === 'VENDOR' && !/^[a-f\d]{24}$/i.test(form.vendorId.trim())) {
      setError('Select a vendor from the list.');
      return;
    }
    if (invalidMrp) {
      setError('MRP must be greater than or equal to vendor price.');
      return;
    }

    if (invalidExtras) {
      setError('Extra selling units need a whole-number base quantity of at least 1.');
      return;
    }
    if (!fixedSize && packageUnit && !form.piecesPerPackage && REQUIRES_NUMBER.includes(String(packageUnit.name).toLowerCase())) {
      setError(`Enter how many base units one ${packageUnit.name} holds.`);
      return;
    }

    if (invalidOverride) {
      setError(`Base unit price cannot be below the margin-safe price of ${money(Math.ceil(autoPiecePrice))}.`);
      return;
    }

    const payload = {
      name: form.name.trim(),
      categoryId: form.categoryId,
      ...(form.brandId ? { brandId: form.brandId } : {}),
      unitId: form.unitId,
      ...(form.baseUnitId ? { baseUnitId: form.baseUnitId } : {}),
      ownerType: form.ownerType,
      ...(form.ownerType === 'VENDOR' ? { vendorId: form.vendorId.trim() } : {}),
      vendorPrice: roundedVendorPrice,
      mrp: roundedMrp,
      ...(hasPieces ? { unitsPerPackage } : {}),
      ...(sellingUnits.length ? { sellingUnits } : {}),
      ...(hasPieces && overrideValue !== null ? { subUnitPriceOverride: overrideValue } : {}),
      vatApplicable: form.vatApplicable,
      ...(form.vatApplicable && form.vatRate !== '' ? { vatRate: Number(form.vatRate) } : {}),
    };

    setSaving(true);
    try {
      await onSubmit(payload);
      onClose();
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Unable to create product.');
    } finally {
      setSaving(false);
    }
  }

  async function addCategory(payload) {
    const { data } = await createCategory(token, payload);
    setCategories((current) => [...current, data.category].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((current) => ({ ...current, categoryId: data.category.id }));
  }

  async function addBrand(payload) {
    const { data } = await createBrand(token, payload);
    setBrands((current) => [...current, data.brand].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((current) => ({ ...current, brandId: data.brand.id }));
  }

  async function addUnit(payload) {
    const { data } = await createUnit(token, payload);
    setUnits((current) => [...current, data.unit].sort((a, b) => a.name.localeCompare(b.name)));
    setForm((current) => ({ ...current, unitId: data.unit.id }));
  }

  function update(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'piecesPerPackage') {
        piecesEdited.current = value !== '';
      } else if (field === 'unitId') {
        const fixed = defaultPiecesPerPackage(units.find((item) => item.id === next.unitId));
        if (fixed) next.piecesPerPackage = '';
      }
      return next;
    });
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Add new product" className="product-form-modal">
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="Product name" name="name" value={form.name} onChange={(event) => update('name', event.target.value)} required maxLength={150} autoFocus />
            <Select label="Owner" name="ownerType" value={form.ownerType} onChange={(event) => update('ownerType', event.target.value)}>
              <option value="COMPANY"><T>{"Company"}</T></option>
              <option value="VENDOR"><T>{"Vendor"}</T></option>
            </Select>
          </div>

          {form.ownerType === 'VENDOR' && (
            <VendorAutocomplete token={token} value={form.vendorId} onChange={(id) => update('vendorId', id)} />
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <Select label="Category" name="categoryId" value={form.categoryId} onChange={(event) => update('categoryId', event.target.value)} required className="w-full min-w-0">
                <option value=""><T>{"Select category"}</T></option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </Select>
              {can('categories:write') && <Button type="button" variant="secondary" size="sm" className="self-end" aria-label="Quick add category" title="Quick add category" onClick={() => setQuickAdd('category')}><Plus size={15} /> <T>{"Quick Add"}</T></Button>}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Select label="Brand" name="brandId" value={form.brandId} onChange={(event) => update('brandId', event.target.value)} className="w-full min-w-0">
                <option value=""><T>{"Select brand (optional)"}</T></option>
                {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
              </Select>
              {can('brands:write') && <Button type="button" variant="secondary" size="sm" className="self-end" aria-label="Quick add brand" title="Quick add brand" onClick={() => setQuickAdd('brand')}><Plus size={15} /> <T>{"Quick Add"}</T></Button>}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <Select label="Package unit (box, sack, dozen, tray)" name="unitId" value={form.unitId} onChange={(event) => update('unitId', event.target.value)} required className="w-full min-w-0">
                <option value=""><T>{"Select unit"}</T></option>
                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.abbreviation})</option>)}
              </Select>
              {can('units:write') && <Button type="button" variant="secondary" size="sm" className="self-end" aria-label="Quick add unit" title="Quick add unit" onClick={() => setQuickAdd('unit')}><Plus size={15} /> <T>{"Quick Add"}</T></Button>}
            </div>
            <Select label="Base unit (pcs, kg)" name="baseUnitId" value={form.baseUnitId} onChange={(event) => update('baseUnitId', event.target.value)} className="w-full min-w-0">
              <option value=""><T>{"Select base unit"}</T></option>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.abbreviation})</option>)}
            </Select>
            <Input label="Barcode" name="barcode" value="Generated when product is saved" readOnly />
          </div>
          {catalogLoading && <p role="status" className="text-xs text-slate-500"><T>{"Loading product categories, brands, and units..."}</T></p>}
          {catalogErrors.map((message) => <p key={message} role="alert" className="text-xs text-amber-800">{message}</p>)}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="Vendor price (৳)" name="vendorPrice" type="number" min="0" step="1" value={form.vendorPrice} onChange={(event) => update('vendorPrice', event.target.value)} required />
            <Input label="MRP (৳)" name="mrp" type="number" min="0" step="1" value={form.mrp} onChange={(event) => update('mrp', event.target.value)} required />
          </div>
          <div className="rounded border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500"><T>{"Margin"}</T></p>
            <p className={`mt-1 text-lg font-semibold ${marginWarning || invalidMrp ? 'text-amber-800' : 'text-slate-900'}`}>
              {margin === null ? 'Enter prices to calculate' : money(margin)}
            </p>
            {invalidMrp && <p role="alert" className="mt-1 text-xs text-red-700"><T>{"MRP must be greater than or equal to vendor price."}</T></p>}
            {marginWarning && !invalidMrp && <p role="status" className="mt-1 text-xs text-amber-800">Margin is below the {discountPercent}% shareholder discount threshold ({money(warningAmount)}).</p>}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {fixedSize ? (
              <p className="flex min-h-10 items-center text-sm text-slate-600">1 {packageUnit.name} = {fixedSize} pcs</p>
            ) : (
              <Input label={`Base units per package (${baseUnit?.name || baseLabel})`} name="piecesPerPackage" type="number" min="1" step="1" value={form.piecesPerPackage} onChange={(event) => update('piecesPerPackage', event.target.value)} />
            )}
            <Input label="Retail price per base unit (Optional)" placeholder="Optional retail price per base unit" name="subUnitPriceOverride" type="number" min="0" step="0.01" value={form.subUnitPriceOverride} onChange={(event) => update('subUnitPriceOverride', event.target.value)} disabled={!hasPieces} />
          </div>
          {helperCost !== null && (
            <div role="status" className="space-y-1 text-xs text-slate-600">
              <p>MRP per base unit: {money(helperCost)} (1 package = {helperPieces} {baseLabel})</p>
              {helperVendorCost !== null && <p>Vendor price per base unit: {money(helperVendorCost)}</p>}
              {invalidOverride && <p className="text-red-700">Custom base unit price must be at least {formatMoney(Math.ceil(autoPiecePrice))}.</p>}
            </div>
          )}

          <div className="space-y-2 rounded border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-700"><T>{"Also sell as"}</T></p>
              <Button type="button" variant="secondary" size="sm" onClick={() => setForm((current) => ({ ...current, sellingUnits: [...current.sellingUnits, { name: '', baseQuantity: '' }] }))}><Plus size={15} /> <T>{"Add unit"}</T></Button>
            </div>
            {form.sellingUnits.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Input label="Unit name" value={row.name} maxLength={30} onChange={(event) => setForm((current) => ({ ...current, sellingUnits: current.sellingUnits.map((entry, i) => (i === index ? { ...entry, name: event.target.value } : entry)) }))} />
                <Input label={`Base quantity (${baseLabel})`} type="number" min="1" step="1" value={row.baseQuantity} onChange={(event) => setForm((current) => ({ ...current, sellingUnits: current.sellingUnits.map((entry, i) => (i === index ? { ...entry, baseQuantity: event.target.value } : entry)) }))} />
                <Button type="button" variant="secondary" size="sm" aria-label="Remove unit" onClick={() => setForm((current) => ({ ...current, sellingUnits: current.sellingUnits.filter((_, i) => i !== index) }))}><X size={15} /></Button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" name="vatApplicable" checked={form.vatApplicable} onChange={(event) => update('vatApplicable', event.target.checked)} />
              <T>{"VAT applicable"}</T>
            </label>
            <Input label="VAT rate (%)" name="vatRate" type="number" min="0" max="100" step="0.01" value={form.vatRate} onChange={(event) => update('vatRate', event.target.value)} required={form.vatApplicable} disabled={!form.vatApplicable} />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}><T>{"Cancel"}</T></Button>
            <Button type="submit" disabled={saving || catalogLoading || !hasPrices || invalidMrp || invalidOverride || invalidExtras}><T>{saving ? "Saving..." : "Save product"}</T></Button>
          </div>
        </form>
      </Modal>
      <QuickAddCategoryModal open={quickAdd === 'category'} onClose={() => setQuickAdd('')} onSubmit={addCategory} />
      <QuickAddBrandModal open={quickAdd === 'brand'} onClose={() => setQuickAdd('')} onSubmit={addBrand} />
      <QuickAddUnitModal open={quickAdd === 'unit'} onClose={() => setQuickAdd('')} onSubmit={addUnit} />
    </>
  );
}
