'use client';

import { useEffect, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { Modal } from '@/components/ui';
import { getCode39Runs } from '@/services/code39.cjs';
import { formatLineQuantity } from '@/services/stock-units.cjs';
import { paymentMethodLabel } from '@/services/pos-screen-utils.cjs';
import { T } from '@/i18n/language-provider';
import './xprinter-print.css';

const money = (value) => (Math.round((Number(value) + Number.EPSILON) * 100) / 100).toFixed(2);

function ReceiptLogo() {
  const [logo, setLogo] = useState(null);

  useEffect(() => {
    let active = true;
    const loadLogo = (source, fallback = false) => {
      const image = new Image();
      image.onload = () => {
        if (!active) return;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas is unavailable');
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          for (let index = 0; index < pixels.data.length; index += 4) {
            const luminance = (
              pixels.data[index] * 0.299
              + pixels.data[index + 1] * 0.587
              + pixels.data[index + 2] * 0.114
            );
            const value = luminance >= 160 ? 255 : 0;
            pixels.data[index] = value;
            pixels.data[index + 1] = value;
            pixels.data[index + 2] = value;
          }
          context.putImageData(pixels, 0, 0);
          setLogo({ src: canvas.toDataURL('image/png'), fallback });
        } catch {
          setLogo({ src: source, fallback });
        }
      };
      image.onerror = () => {
        if (!active) return;
        if (!fallback) loadLogo('/logo.png', true);
        else setLogo(null);
      };
      image.src = source;
    };

    loadLogo('/brand/purebazar-logo.png');
    return () => { active = false; };
  }, []);

  if (!logo) return null;
  return <img className="receipt-logo-img" src={logo.src} alt="PureBazar" />;
}

function OrderBarcode({ value }) {
  let runs;
  try {
    runs = getCode39Runs(value);
  } catch {
    return null;
  }
  const total = runs.reduce((sum, run) => sum + run.width, 0);
  let x = 0;
  return (
    <svg className="receipt-barcode" viewBox={`0 0 ${total} 30`} preserveAspectRatio="none" role="img" aria-label={`Order barcode ${value}`}>
      {runs.map((run, index) => {
        const bar = run.bar && <rect key={index} x={x} y={0} width={run.width} height={30} fill="#000" />;
        x += run.width;
        return bar;
      })}
    </svg>
  );
}

function Receipt({ receipt }) {
  const payments = receipt.payments || [];
  return (
    <div className="receipt-sheet">
      <div className="receipt-center">
        <ReceiptLogo />
        <strong className="receipt-title"><T>{"PureBazar"}</T></strong>
        <div>{new Date(receipt.soldAt || Date.now()).toLocaleString()}</div>
        <div>Invoice: {receipt.orderNumber}</div>
        {receipt.isReprint && <strong className="receipt-reprint">COPY - Reprint</strong>}
      </div>
      <hr />
      <table className="receipt-table">
        <thead><tr><th><T>{"Item"}</T></th><th className="r"><T>{"Qty"}</T></th><th className="r"><T>{"Price"}</T></th><th className="r"><T>{"Total"}</T></th></tr></thead>
        <tbody>
          {receipt.lines.map((line, index) => (
            <tr key={`${line.barcode}-${index}`}>
              <td>
                {line.productName}
                {Number(line.itemDiscountAmount) > 0 && <small className="receipt-line-detail">Item discount: -{money(line.itemDiscountAmount)}</small>}
                {Number(line.billDiscountAmount) > 0 && <small className="receipt-line-detail">Bill discount: -{money(line.billDiscountAmount)}</small>}
                {Number(line.shareholderDiscountAmount) > 0 && <small className="receipt-line-detail">Member discount: -{money(line.shareholderDiscountAmount)}</small>}
                {Number(line.vatAmount) > 0 && <small className="receipt-line-detail">VAT: {money(line.vatAmount)}</small>}
              </td>
              <td className="r">{formatLineQuantity(line)}</td>
              <td className="r">{money(line.mrp)}</td>
              <td className="r">{money(line.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <div className="receipt-row"><span><T>{"Subtotal"}</T></span><span>{money(receipt.subtotal)}</span></div>
      {Number(receipt.otherDiscountAmount) > 0 && <div className="receipt-row"><span><T>{"Discount"}</T></span><span>-{money(receipt.otherDiscountAmount)}</span></div>}
      {Number(receipt.shareholderDiscountAmount) > 0 && <div className="receipt-row"><span><T>{"Member discount"}</T></span><span>-{money(receipt.shareholderDiscountAmount)}</span></div>}
      {Number(receipt.vatAmount) > 0 && <div className="receipt-row"><span><T>{"VAT"}</T></span><span>{money(receipt.vatAmount)}</span></div>}
      <div className="receipt-row receipt-grand"><span><T>{"TOTAL (BDT)"}</T></span><span>{money(receipt.grandTotal)}</span></div>
      {payments.map((payment, index) => (
        <div key={`${payment.method}-${index}`} className="receipt-row"><span>{paymentMethodLabel(payment.method)}</span><span>{money(payment.amount)}</span></div>
      ))}
      {receipt.walletOffline && receipt.walletVerification === 'pending' && (
        <div className="receipt-center text-sm">Wallet verification pending</div>
      )}
      <div className="receipt-center receipt-barcode-wrap">
        <OrderBarcode value={receipt.orderNumber} />
        <div>{receipt.orderNumber}</div>
        <div>Thank you for shopping!</div>
      </div>
    </div>
  );
}

export default function InvoiceModal({ receipt, onClose }) {
  const [width, setWidth] = useState('80mm');

  useEffect(() => {
    document.body.dataset.printMode = `receipt-${width}`;
    return () => { delete document.body.dataset.printMode; };
  }, [width]);

  function printReceipt() {
    window.print();
  }

  const pageSize = `${width} auto`;

  return (
    <Modal
      open
      onClose={onClose}
      bare
      ariaLabel="Invoice"
      backdropClassName="print:static print:bg-transparent print:p-0"
      className="flex max-h-full w-full max-w-md flex-col rounded-xl bg-white shadow-xl print:max-h-none print:max-w-none print:shadow-none"
    >
      <style>{`@media print { @page { size: ${pageSize}; margin: 0; } }`}</style>
      <div className="print-actions flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold text-slate-900">Invoice · {receipt.orderNumber}</h2>
        <button type="button" onClick={onClose} aria-label="Close invoice" className="rounded p-1 hover:bg-slate-100"><X size={18} /></button>
      </div>
      <div className="print-actions flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm">
        <select aria-label="Paper width" value={width} onChange={(event) => setWidth(event.target.value)} className="rounded border border-slate-300 px-2 py-1">
          <option value="80mm">80mm</option>
          <option value="58mm">58mm</option>
        </select>
      </div>
      <div className="overflow-auto bg-slate-100 p-4 print:overflow-visible print:bg-white print:p-0">
        <div id="pos-print-area" className="mx-auto bg-white p-2">
          <Receipt receipt={receipt} />
        </div>
      </div>
      <div className="print-actions flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
        <button type="button" onClick={printReceipt} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white"><Printer size={15} /> <T>{"Print Receipt"}</T></button>
      </div>
    </Modal>
  );
}
