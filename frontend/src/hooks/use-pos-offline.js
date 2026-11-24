'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPosCatalog, posErrorMessage, syncOfflinePosBill } from '@/services/pos';
import {
  allocateOfflineNumber,
  enqueueOfflineBill,
  listOfflineBills,
  readPosCatalog,
  removeOfflineBill,
  savePosCatalog,
  updateOfflineBill,
} from '@/services/pos-offline-storage';

export default function usePosOffline(outletId, userId, offlineEnabled = true) {
  const [browserOnline, setBrowserOnline] = useState(
    () => (typeof navigator === 'undefined' ? true : navigator.onLine),
  );
  const [networkAvailable, setNetworkAvailable] = useState(true);
  const [catalog, setCatalog] = useState(null);
  const [queuedBills, setQueuedBills] = useState([]);
  const [syncResults, setSyncResults] = useState([]);
  const [catalogError, setCatalogError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const online = browserOnline && networkAvailable;

  const reportNetwork = useCallback((available) => {
    setNetworkAvailable(available);
    window.dispatchEvent(new CustomEvent('purebazar:network-status', { detail: available }));
  }, []);

  const refreshQueue = useCallback(async () => {
    if (!offlineEnabled || !userId) {
      setQueuedBills([]);
      return [];
    }
    const bills = await listOfflineBills(userId);
    setQueuedBills(bills);
    return bills;
  }, [offlineEnabled, userId]);

  const refreshCatalog = useCallback(async (targetOutletId) => {
    if (!offlineEnabled) {
      setCatalog(null);
      setCatalogError('');
      return null;
    }
    if (!targetOutletId) return null;
    if (!navigator.onLine) {
      setBrowserOnline(false);
      const cached = await readPosCatalog(targetOutletId);
      setCatalog(cached || null);
      setCatalogError(cached ? '' : 'Connect to the internet once to download this outlet catalog.');
      return null;
    }
    try {
      const { data } = await getPosCatalog(targetOutletId);
      const pending = userId ? await listOfflineBills(userId) : [];
      const deductions = new Map();
      pending.filter((bill) => bill.outletId === String(targetOutletId))
        .forEach((bill) => bill.stockDeductions.forEach((line) => {
          const id = String(line.productId);
          deductions.set(id, (deductions.get(id) || 0) + Number(line.quantity));
        }));
      const cachedCatalog = {
        ...data,
        outletId: data.outlet.id,
        items: data.items.map((item) => ({
          ...item,
          stock: Number(item.stock || 0) - (deductions.get(String(item.productId)) || 0),
        })),
      };
      await savePosCatalog(cachedCatalog);
      setCatalog(cachedCatalog);
      setBrowserOnline(true);
      reportNetwork(true);
      setCatalogError('');
      return data;
    } catch (error) {
      if (!error.response || error.response.status >= 500) reportNetwork(false);
      const cached = await readPosCatalog(targetOutletId);
      setCatalog(cached || null);
      setCatalogError(cached
        ? ''
        : `${posErrorMessage(error)} No offline catalog is available for this outlet.`);
      return null;
    }
  }, [offlineEnabled, reportNetwork, userId]);

  const syncPending = useCallback(async (targetOutletId) => {
    if (!offlineEnabled || !navigator.onLine || !targetOutletId || !userId) return;
    const bills = (await listOfflineBills(userId))
      .filter((bill) => bill.outletId === String(targetOutletId));
    if (!bills.length) {
      setQueuedBills(await listOfflineBills(userId));
      return;
    }
    setSyncing(true);
    for (const bill of bills) {
      try {
        const { data } = await syncOfflinePosBill(bill.payload, targetOutletId);
        await removeOfflineBill(bill.offlineId);
        setSyncResults((current) => [{
          offlineNumber: bill.offlineNumber,
          status: data.flagged ? 'flagged' : 'synced',
          detail: data.walletUnverifiable
            ? 'wallet '
            : data.reviewFlags?.join(', ') || '',
        }, ...current].slice(0, 20));
      } catch (error) {
        const detail = posErrorMessage(error);
        await updateOfflineBill({ ...bill, lastError: detail });
        setSyncResults((current) => [{
          offlineNumber: bill.offlineNumber, status: 'failed', detail,
        }, ...current].slice(0, 20));
        if (!error.response || error.response.status >= 500) {
          reportNetwork(false);
          break;
        }
      }
      await refreshQueue();
    }
    await refreshQueue();
    setSyncing(false);
  }, [offlineEnabled, refreshQueue, reportNetwork, userId]);

  const queueOfflineBill = useCallback(async (bill) => {
    if (!offlineEnabled) throw new Error('Offline POS is not available for this user.');
    if (!catalog?.outlet || !catalog.offlineNumberRange) {
      throw new Error('Offline bill numbers are not available. Reconnect and refresh the POS catalog.');
    }
    const offlineNumber = await allocateOfflineNumber(
      catalog.outlet.id,
      catalog.outlet.code,
      catalog.offlineNumberRange,
    );
    const queued = {
      ...bill,
      payload: {
        ...bill.payload,
        offlineId: bill.offlineId,
        offlineNumber,
      },
      offlineNumber,
      outletId: String(catalog.outlet.id),
      userId: String(userId),
      soldAt: bill.payload.soldAt,
      queuedAt: new Date().toISOString(),
    };
    await enqueueOfflineBill(queued);
    setCatalog(await readPosCatalog(catalog.outlet.id));
    await refreshQueue();
    return queued;
  }, [catalog, offlineEnabled, refreshQueue, userId]);

  useEffect(() => {
    setBrowserOnline(navigator.onLine);
    const onOffline = () => setBrowserOnline(false);
    const onOnline = async () => {
      setBrowserOnline(true);
      const fresh = await refreshCatalog(outletId);
      if (fresh) await syncPending(outletId);
    };
    const onNetworkStatus = (event) => setNetworkAvailable(Boolean(event.detail));
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener('purebazar:network-status', onNetworkStatus);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('purebazar:network-status', onNetworkStatus);
    };
  }, [outletId, refreshCatalog, reportNetwork, syncPending]);

  useEffect(() => {
    if (!outletId) return;
    let active = true;
    (async () => {
      const fresh = await refreshCatalog(outletId);
      await refreshQueue();
      if (active && fresh) await syncPending(outletId);
    })();
    return () => { active = false; };
  }, [outletId, refreshCatalog, refreshQueue, syncPending]);

  return {
    online,
    browserOnline,
    apiReachable: networkAvailable,
    catalog,
    queuedBills,
    syncResults,
    catalogError,
    syncing,
    queueOfflineBill,
    refreshCatalog: () => refreshCatalog(outletId),
  };
}
