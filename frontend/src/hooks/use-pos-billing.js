'use client';

import { useEffect, useRef, useState } from 'react';
import { checkoutPosBill, posErrorMessage, previewPosBill } from '@/services/pos';
import {
  estimateTotal, useHeldSales,
} from '@/components/pos/held-sales';
import billingUtils from '@/services/pos-billing-utils.cjs';
import { hasStockProblem } from '@/services/pos-cart-utils.cjs';
import offlineEngine from '@/services/pos-offline-engine.cjs';
import offlineReceipt from '@/services/pos-offline-receipt.cjs';

const { calculateOfflineBill, offlineWalletError } = offlineEngine;
const { createOfflineReceipt } = offlineReceipt;
const { createPreviewPayload, paymentTotalMatches } = billingUtils;

function createOfflineUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  if (!window.crypto?.getRandomValues) throw new Error('This browser cannot create a secure offline bill ID.');
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export default function usePosBilling({
  user, canWrite, canApprove, offlineEnabled = true, online, catalog, queueOfflineBill, selectedOutletId,
  hasOutletSelection, items, setItems, billDiscount, setBillDiscount,
}) {
  const [methods, setMethods] = useState(['CASH']);
  const [amounts, setAmounts] = useState({});
  const [bill, setBill] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [discountApproved, setDiscountApproved] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [heldOpen, setHeldOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const { held, hold, remove: discardHeld } = useHeldSales();
  const latestPreview = useRef(0);
  const selectedMethods = methods.includes('WALLET') ? ['WALLET'] : methods;
  const singleMethod = selectedMethods.length === 1 ? selectedMethods[0] : null;
  const offlineWalletAllowed = !online && catalog?.settings?.allowWalletPaymentOffline === true;
  const offlineWalletMessage = !online && selectedMethods.includes('WALLET')
    ? offlineWalletError(
      catalog?.settings || {},
      bill?.grandTotal || 0,
    )
    : '';
  let payload;
  let formError = '';
  try {
    payload = createPreviewPayload(items, billDiscount, selectedMethods);
  } catch (error) {
    payload = null;
    formError = error.message;
  }
  const previewKey = payload ? JSON.stringify(payload) : '';

  useEffect(() => {
    const requestId = ++latestPreview.current;
    let cancelled = false;
    if (!items.length || !payload || !hasOutletSelection) {
      setBill(null);
      setPreviewError('');
      setPreviewLoading(false);
      return () => { cancelled = true; };
    }
    setBill(null);
    if (!online) {
      try {
        if (!catalog) throw new Error('Connect online to cache this outlet catalog before selling.');
        const localBill = calculateOfflineBill(items, billDiscount, selectedMethods, {
          ...catalog.settings,
          role: user.role,
        });
        if (!cancelled && requestId === latestPreview.current) setBill(localBill);
        setPreviewError('');
      } catch (error) {
        if (!cancelled && requestId === latestPreview.current) setPreviewError(error.message);
      } finally {
        if (!cancelled && requestId === latestPreview.current) setPreviewLoading(false);
      }
      return () => { cancelled = true; };
    }
    setPreviewLoading(true);
    setPreviewError('');
    previewPosBill(payload, selectedOutletId).then(({ data }) => {
      if (!cancelled && requestId === latestPreview.current) setBill(data.bill);
    }).catch((error) => {
      if (!cancelled && requestId === latestPreview.current) setPreviewError(posErrorMessage(error));
    }).finally(() => {
      if (!cancelled && requestId === latestPreview.current) setPreviewLoading(false);
    });
    return () => { cancelled = true; };
  // previewKey captures all data that determines server pricing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, hasOutletSelection, online, previewKey, selectedOutletId, items.length, user?.role]);

  useEffect(() => {
    if (!online && methods.includes('WALLET') && !offlineWalletAllowed) {
      setMethods(['CASH']);
      setAmounts({});
      setCheckoutError('Wallet and Probashi-dependent payments need an internet connection.');
    }
  }, [methods, online, offlineWalletAllowed]);

  useEffect(() => {
    if (singleMethod && singleMethod !== 'WALLET' && bill) {
      const total = bill.grandTotal.toFixed(2);
      setAmounts((current) => (current[singleMethod] === total
        ? current
        : { ...current, [singleMethod]: total }));
    }
  }, [bill, singleMethod]);

  function changeMethods(next) {
    setMethods(next);
    setDiscountApproved(false);
    setCheckoutError('');
  }

  function updateAmount(method, amount) {
    setAmounts((current) => ({ ...current, [method]: amount }));
  }

  function resetCart() {
    setItems([]);
    setBillDiscount(null);
    setMethods(['CASH']);
    setAmounts({});
    setDiscountApproved(false);
    setBill(null);
    setCheckoutError('');
  }

  async function checkout() {
    if (!bill || !payload || !canWrite || checkoutLoading) return;
    setCheckoutLoading(true);
    setCheckoutError('');
    setSuccessMessage('');
    try {
      const payments = selectedMethods.map((method) => ({
        method,
        amount: method === 'WALLET' ? bill.grandTotal : Number(amounts[method]),
      }));
      if (!online) {
        if (offlineWalletMessage) throw new Error(offlineWalletMessage);
        const soldAt = new Date().toISOString();
        const queued = await queueOfflineBill({
          offlineId: createOfflineUuid(),
          payload: {
            ...payload,
            payments,
            soldAt,
            ...(selectedMethods.includes('WALLET') ? {
              walletOffline: true,
            } : {}),
            ...(canApprove && discountApproved ? { discountApproved: true } : {}),
          },
          stockDeductions: bill.lines.map(({ item, pricing }) => ({
            productId: String(item.productId),
            quantity: pricing.stockQuantity,
          })),
        });
        setSuccessMessage(`Sale completed · ${queued.offlineNumber} (queued for sync).`);
        setReceipt(createOfflineReceipt(bill, queued, user, catalog.outlet.id, payments));
        resetCart();
        return;
      }
      const { data } = await checkoutPosBill({
        ...payload,
        payments,
        ...(discountApproved ? { discountApproved: true } : {}),
      }, selectedOutletId);
      setSuccessMessage(`Sale completed${data.order?.orderNumber ? ` · ${data.order.orderNumber}` : ''}.`);
      resetCart();
      if (data.receipt) setReceipt(data.receipt);
    } catch (error) {
      if (error.response?.status === 409 && error.response.data?.sufficient === false) {
        setMethods(['CASH']);
        setAmounts({ CASH: Number(error.response.data.bill?.grandTotal || 0).toFixed(2) });
      }
      setCheckoutError(posErrorMessage(error));
    } finally {
      setCheckoutLoading(false);
    }
  }

  function holdSale() {
    if (!offlineEnabled && !online) {
      setCheckoutError('Offline POS is available only for cashiers and outlet managers.');
      return;
    }
    if (!items.length) {
      setCheckoutError('Cart is empty. Add items before holding a sale.');
      return;
    }
    setHoldOpen(true);
  }

  function confirmHold(noteText) {
    const note = noteText.trim();
    setHoldOpen(false);
    hold({
      note,
      items,
      billDiscount,
      methods,
      amounts,
      itemCount: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      total: bill?.grandTotal ?? estimateTotal(items),
    });
    resetCart();
    setSuccessMessage(`Sale held${note ? ` · ${note}` : ''}.`);
  }

  function restoreSale(sale) {
    if (items.length && !window.confirm('The current cart has items. OK = replace it with the held bill; Cancel = keep current cart.')) return;
    resetCart();
    setItems(sale.items);
    setBillDiscount(sale.billDiscount || null);
    setMethods(sale.methods?.length ? sale.methods : ['CASH']);
    setAmounts(sale.amounts || {});
    discardHeld(sale.id);
    setHeldOpen(false);
    setSuccessMessage('Held bill restored.');
  }

  const paymentsMatch = bill && paymentTotalMatches(selectedMethods, amounts, bill.grandTotal);
  const approvalReady = !online || !bill?.discountApprovalRequired || (canApprove && discountApproved);
  const canCheckoutNow = canWrite && items.length > 0 && bill && !previewLoading && !previewError
    && !formError && !checkoutLoading && selectedMethods.length > 0
    && paymentsMatch && !offlineWalletMessage && approvalReady
    && (!online || !hasStockProblem(items)) && hasOutletSelection;

  return {
    methods, selectedMethods, amounts, offlineWalletAllowed,
    offlineWalletMessage, bill, previewLoading, previewError, discountApproved,
    setDiscountApproved, checkoutLoading, checkoutError, setCheckoutError, successMessage,
    setSuccessMessage, heldOpen, setHeldOpen, holdOpen, setHoldOpen, receipt, setReceipt,
    held, discardHeld, payload, formError, changeMethods, updateAmount, checkout, resetCart,
    holdSale, confirmHold, restoreSale, updateBillDiscountApproval: setDiscountApproved,
    canCheckout: Boolean(canCheckoutNow),
  };
}
