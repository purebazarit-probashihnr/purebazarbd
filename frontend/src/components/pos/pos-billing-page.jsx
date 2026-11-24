'use client';

import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import useAuth from '@/store/use-auth';
import usePosOutlet from '@/hooks/use-pos-outlet';
import usePosOffline from '@/hooks/use-pos-offline';
import usePosCart from '@/hooks/use-pos-cart';
import usePosBilling from '@/hooks/use-pos-billing';
import useToastMessages from '@/hooks/use-toast-messages';
import CartPanel from './cart-panel';
import BillSummary from './bill-summary';
import ItemScanner from './item-scanner';
import PaymentPanel from './payment-panel';
import PosOutletSelector from './outlet-selector';
import OfflineSyncStatus from './offline-sync-status';
import {
  HeldBillsButton, HeldBillsModal,
} from './held-sales';
import HoldSaleModal from './hold-sale-modal';
import InvoiceModal from './invoice-modal';
import ErrorToast from './error-toast';
import { T } from '@/i18n/language-provider';
import offlinePosAccess from '@/services/offline-pos-access.cjs';

const { isOfflinePosUser } = offlinePosAccess;

export default function PosBillingPage() {
  const {
    initialized, token, user, hasPermission,
  } = useAuth();
  const canRead = hasPermission('pos:read');
  const canWrite = hasPermission('pos:write');
  const canApprove = user?.role === 'Super Admin';
  const offlinePosUser = isOfflinePosUser(user);
  const {
    isSuperAdmin, outlets, selectedOutletId, setSelectedOutletId, loadingOutlets, outletError,
  } = usePosOutlet();
  const assignedOutletId = String(user?.locationId?._id || user?.locationId || '');
  const outletId = offlinePosUser ? assignedOutletId : (selectedOutletId || assignedOutletId);
  const {
    online, catalog, queuedBills, syncResults, catalogError, syncing, queueOfflineBill,
  } = usePosOffline(outletId, user?.id, offlinePosUser);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }, [toastTimer]);
  useEffect(() => () => clearTimeout(toastTimer.current), [toastTimer]);

  const cart = usePosCart({
    online, catalog, catalogError, showToast,
  });
  const hasOutletSelection = !isSuperAdmin || Boolean(selectedOutletId);
  const billing = usePosBilling({
    user,
    canWrite,
    canApprove,
    offlineEnabled: offlinePosUser,
    online,
    catalog,
    queueOfflineBill,
    selectedOutletId,
    hasOutletSelection,
    items: cart.items,
    setItems: cart.setItems,
    billDiscount: cart.billDiscount,
    setBillDiscount: cart.setBillDiscount,
  });
  useToastMessages({
    success: billing.successMessage,
    error: billing.checkoutError || billing.previewError,
  });
  useEffect(() => {
    const warnBeforeLeaving = (event) => {
      if (!cart.items.length && !queuedBills.length) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [cart.items.length, queuedBills.length]);

  if (!initialized) return <p role="status" className="py-10 text-center"><T>{"Loading your POS session..."}</T></p>;
  if (!token || !canRead) return <p role="alert" className="rounded bg-red-50 p-4 text-red-800"><T>{"You do not have permission to view the POS."}</T></p>;
  if (!canWrite) return <p role="alert" className="rounded bg-red-50 p-4 text-red-800"><T>{"You do not have permission to complete POS sales."}</T></p>;
  if (!offlinePosUser && !online) {
    return (
      <section className="mx-auto max-w-7xl">
        <p role="alert" className="rounded-lg bg-amber-50 p-4 text-sm font-medium text-amber-900">
          Offline POS is available only for cashiers and outlet managers. Connect to the internet to use POS.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500"><T>{"Sales"}</T></p>
          <h1 className="text-2xl font-semibold text-slate-900"><T>{"Point of Sale"}</T></h1>
          <p className="mt-1 text-sm text-slate-600"><T>{"Scan items, apply permitted discounts, and complete a bill."}</T></p>
        </div>
        <div className="flex gap-2">
          <OfflineSyncStatus
            online={online}
            count={queuedBills.length}
            syncing={syncing}
            results={syncResults}
            queuedBills={queuedBills}
          />
          <button type="button" onClick={billing.holdSale} disabled={!cart.items.length || billing.checkoutLoading} className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"><T>{"Hold Sale"}</T></button>
          <HeldBillsButton count={billing.held.length} onClick={() => billing.setHeldOpen(true)} />
        </div>
      </header>
      {catalogError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{catalogError}</p>}
      <PosOutletSelector
        isSuperAdmin={isSuperAdmin}
        outlets={outlets}
        selectedOutletId={selectedOutletId}
        loading={loadingOutlets}
        error={outletError}
        onChange={(event) => {
          setSelectedOutletId(event.target.value);
          billing.resetCart();
        }}
      />
      {isSuperAdmin && !selectedOutletId && !loadingOutlets && !outletError && (
        <p className="text-sm text-slate-600" role="status"><T>{"Select an outlet before using POS."}</T></p>
      )}
      <ErrorToast message={toast || billing.formError} onClose={toast ? () => setToast('') : undefined} />
      {billing.receipt && <InvoiceModal receipt={billing.receipt} onClose={() => billing.setReceipt(null)} />}
      {billing.holdOpen && <HoldSaleModal onConfirm={billing.confirmHold} onCancel={() => billing.setHoldOpen(false)} />}
      {billing.heldOpen && (
        <HeldBillsModal
          held={billing.held}
          onRestore={billing.restoreSale}
          onDiscard={billing.discardHeld}
          onClose={() => billing.setHeldOpen(false)}
        />
      )}
      {hasOutletSelection && !loadingOutlets && !outletError && (
        <ItemScanner
          key={selectedOutletId}
          onAdd={cart.addItem}
          selectedOutletId={outletId}
          offline={!online}
          catalog={catalog?.items || []}
        />
      )}
      {hasOutletSelection && !loadingOutlets && !outletError && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            <CartPanel
              items={cart.items}
              offline={!online}
              onQuantity={cart.updateQuantity}
              onUnit={cart.updateUnit}
              onRemove={(id) => cart.setItems((current) => current.filter((item) => item.productId !== id))}
              onDiscount={cart.updateItemDiscount}
              onVendorChange={cart.changeVendor}
            />
            <PaymentPanel
              methods={billing.selectedMethods}
              amounts={billing.amounts}
              total={billing.bill?.grandTotal || 0}
              onMethods={billing.changeMethods}
              onAmount={billing.updateAmount}
              offlineWalletAllowed={billing.offlineWalletAllowed}
              offlineWalletMaximum={billing.offlineWalletMaximum}
              walletError={billing.offlineWalletMessage}
              offline={!online}
            />
          </div>
          <BillSummary
            bill={billing.bill}
            billDiscount={cart.billDiscount}
            onBillDiscount={cart.updateBillDiscount}
            approvalRequired={Boolean(billing.bill?.discountApprovalRequired)}
            canApprove={canApprove}
            offline={!online}
            discountApproved={billing.discountApproved}
            onApprove={billing.setDiscountApproved}
            previewLoading={billing.previewLoading}
            previewError={billing.previewError}
            onCheckout={billing.checkout}
            checkoutLoading={billing.checkoutLoading}
            checkoutError={billing.checkoutError}
            canCheckout={billing.canCheckout}
          />
        </div>
      )}
    </section>
  );
}
