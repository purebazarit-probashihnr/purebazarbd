'use client';

import useBarcodeScanner from '@/hooks/use-barcode-scanner';
import { Input } from '@/components/ui';
import { displayId } from '@/components/inventory/stock-transfer-display';

export default function TransferChallanScanner({ transfers, onSelect, onError }) {
  function openTransfer(value) {
    const number = value.trim().toUpperCase();
    const transfer = transfers.find((item) => (
      item.transferNumber === number
      || item.id.toUpperCase() === number
      || displayId(item.id) === number
    ));
    if (!transfer) {
      onError(`No transfer found for challan ${number}.`);
      return;
    }
    onSelect(transfer);
  }
  const scanner = useBarcodeScanner(openTransfer);

  return (
    <div className="mb-4 max-w-md">
      <Input
        label="Scan transfer challan barcode"
        value={scanner.value}
        onChange={scanner.onChange}
        onKeyDown={scanner.onKeyDown}
        placeholder="Scan or enter challan number"
      />
    </div>
  );
}
