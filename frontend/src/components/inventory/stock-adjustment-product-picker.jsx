'use client';

import { Input } from '@/components/ui';
import CameraBarcodeScanner from '@/components/common/camera-barcode-scanner';
import { stockText } from '@/services/stock-adjustment-units.cjs';
import { T } from '@/i18n/language-provider';

export default function StockAdjustmentProductPicker({
  warehouseId, canReadProducts, scanner, onScan, search, onSearchChange,
  searching, searchError, matches, onAddProduct,
}) {
  const disabled = !warehouseId || !canReadProducts;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="flex items-end gap-2">
        <Input className="min-w-0 flex-1" label="Scan barcode and press Enter" name="barcodeScanner" value={scanner.value} onChange={scanner.onChange} onKeyDown={scanner.onKeyDown} placeholder="Focus here, then scan a product barcode" disabled={disabled} />
        <CameraBarcodeScanner onScan={onScan} disabled={disabled} />
      </div>
      <div className="relative">
        <div className="flex items-end gap-2">
          <Input className="min-w-0 flex-1" label="Find product" name="productSearch" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search name or barcode" disabled={disabled} />
          <CameraBarcodeScanner onScan={onSearchChange} disabled={disabled} />
        </div>
        {searching && <p role="status" className="mt-1 text-xs text-slate-500"><T>{"Searching products..."}</T></p>}
        {searchError && <p role="alert" className="mt-1 text-xs text-red-700">{searchError}</p>}
        {matches.length > 0 && <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded border border-slate-200 bg-white shadow-lg">
          {matches.map((product) => <button key={product.id} type="button" className="block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50" onClick={() => onAddProduct(product)}>
            <span className="block text-sm font-medium">{product.name}</span>
            <small className="text-slate-500">{product.barcode} {product.vendorName ? `· ${product.vendorName}` : ''} · Current stock: {stockText(product.stockQuantity, product)}</small>
          </button>)}
        </div>}
        {search.trim() && !searching && !searchError && matches.length === 0 && <p className="mt-1 text-xs text-slate-500"><T>{"No products found for this search."}</T></p>}
      </div>
    </div>
  );
}
