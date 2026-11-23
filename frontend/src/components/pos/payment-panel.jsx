'use client';

import { WalletCards } from 'lucide-react';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import { T } from '@/i18n/language-provider';

const options = [
  ['CASH', 'Cash'],
  ['BKASH', 'bKash'],
  ['NAGAD', 'Nagad'],
  ['CARD', 'Card'],
];
const money = (value) => (Number(value) || 0).toFixed(2);

export default function PaymentPanel({
  methods, amounts, total, onMethods, onAmount, offline = false,
  walletMemberId = '', walletReference = '', onWalletMemberId, onWalletReference,
  offlineWalletAllowed = false, offlineWalletDetailsRequired = false,
  offlineWalletMaximum = 2000, walletError = '',
}) {
  const selected = methods.includes('WALLET') ? ['WALLET'] : methods;
  const paid = selected.reduce((sum, method) => sum + (Number(amounts[method]) || 0), 0);
  const due = Math.round((total - paid + Number.EPSILON) * 100) / 100;
  const invalidAmount = selected.some((method) => (
    !Number.isFinite(Number(amounts[method])) || Number(amounts[method]) <= 0
  ));

  function toggle(method, checked) {
    if (checked) onMethods(method === 'WALLET' ? ['WALLET'] : [...selected.filter((item) => item !== 'WALLET'), method]);
    else onMethods(selected.filter((item) => item !== method));
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold text-slate-900"><T>{"Payment"}</T></h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {options.map(([method, label]) => (
          <label key={method} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm">
            <input type="checkbox" checked={selected.includes(method)} onChange={(event) => toggle(method, event.target.checked)} />
            {label}
          </label>
        ))}
      </div>
      <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm">
        <input type="checkbox" checked={selected.includes('WALLET')} disabled={offline && !offlineWalletAllowed} onChange={(event) => toggle('WALLET', event.target.checked)} />
        <WalletCards size={17} /> Full wallet payment (no split)
      </label>
      {offline && !offlineWalletAllowed && <p role="status" className="mt-2 text-sm text-amber-800">Wallet payments require an internet connection.</p>}
      {selected.includes('WALLET') ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
          <p className="text-emerald-800">Wallet pays ৳{money(total)}.</p>
          {offline && offlineWalletAllowed && (
            <div className="mt-3 space-y-3">
              <p role="status" className="text-amber-800">Wallet payment will be verified when internet returns.</p>
              <Input label="Member ID" value={walletMemberId} onChange={(event) => onWalletMemberId(event.target.value)} required={offlineWalletDetailsRequired} autoComplete="off" />
              <Input label="Probashi transaction reference" value={walletReference} onChange={(event) => onWalletReference(event.target.value)} required={offlineWalletDetailsRequired} autoComplete="off" />
              {Number(total) > Number(offlineWalletMaximum) && <p role="alert" className="text-red-700">Offline wallet payment is limited to ৳{money(offlineWalletMaximum)} per bill.</p>}
              {walletError && Number(total) <= Number(offlineWalletMaximum) && <p role="alert" className="text-red-700">{walletError}</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {!selected.length && <p role="alert" className="text-sm text-red-700"><T>{"Select at least one payment method."}</T></p>}
          {selected.map((method) => (
            <div key={method} className="grid grid-cols-[1fr_auto] items-end gap-2">
              <Input
                label={`${options.find(([key]) => key === method)?.[1]} amount (৳)`}
                type="number"
                min="0"
                step="0.01"
                value={amounts[method] ?? ''}
                onChange={(event) => onAmount(method, event.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onAmount(method, money(total - selected.filter((other) => other !== method)
                  .reduce((sum, other) => sum + (Number(amounts[other]) || 0), 0)))}
              >
                Set remaining
              </Button>
            </div>
          ))}
          <p className={due === 0 && !invalidAmount ? 'text-sm text-emerald-800' : 'text-sm text-amber-800'}>
            {invalidAmount
              ? 'Every selected payment method needs a positive amount.'
              : due === 0
                ? 'Payment amounts match the bill.'
                : due > 0
                  ? `Remaining to allocate: ৳${money(due)}`
                  : `Overpaid by: ৳${money(Math.abs(due))}`}
          </p>
        </div>
      )}
    </section>
  );
}
