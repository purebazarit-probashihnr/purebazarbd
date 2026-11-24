'use client';

import { useEffect, useState } from 'react';
import useAuth from '@/store/use-auth';
import { getLocations } from '@/services/stock';

export default function usePosOutlet({
  allowAllLocations = false,
  allowLocationSelection = false,
  defaultAssignedOutlet = false,
  defaultFirstOutlet = false,
  refreshKey = 0,
} = {}) {
  const { token, user } = useAuth();
  const isSuperAdmin = user?.role === 'Super Admin' || user?.permissions?.includes('*');
  const canSelectOutlet = isSuperAdmin
    || ((allowAllLocations || allowLocationSelection) && Boolean(user?.canViewAllLocations));
  const assignedLocationId = String(user?.locationId?._id || user?.locationId || '');
  const [outlets, setOutlets] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState('');
  const [loadingOutlets, setLoadingOutlets] = useState(false);
  const [outletError, setOutletError] = useState('');

  useEffect(() => {
    if (!canSelectOutlet || !token) {
      setOutlets([]);
      setSelectedOutletId('');
      setLoadingOutlets(false);
      setOutletError('');
      return undefined;
    }

    let active = true;
    setLoadingOutlets(true);
    setOutletError('');
    getLocations(token, 'OUTLET').then(({ data }) => {
      if (!active) return;
      const activeOutlets = data.locations.filter((location) => location.isActive);
      setOutlets(activeOutlets);
      setSelectedOutletId((current) => {
        if (allowAllLocations) {
          return current === 'all' || activeOutlets.some((location) => location.id === current)
            ? current
            : 'all';
        }
        if (activeOutlets.some((location) => location.id === current)) return current;
        if (defaultAssignedOutlet && !isSuperAdmin
          && activeOutlets.some((location) => location.id === assignedLocationId)) {
          return assignedLocationId;
        }
        return defaultFirstOutlet ? activeOutlets[0]?.id || '' : '';
      });
    }).catch((error) => {
      if (!error.response || error.response.status >= 500) {
        window.dispatchEvent(new CustomEvent('purebazar:network-status', { detail: false }));
      }
      if (active) setOutletError(error.response?.data?.message || 'Unable to load active outlets.');
    }).finally(() => {
      if (active) setLoadingOutlets(false);
    });

    return () => { active = false; };
  }, [allowAllLocations, assignedLocationId, canSelectOutlet, defaultAssignedOutlet, defaultFirstOutlet, isSuperAdmin, refreshKey, token]);

  return {
    isSuperAdmin,
    canSelectOutlet,
    outlets,
    selectedOutletId,
    setSelectedOutletId,
    loadingOutlets,
    outletError,
  };
}
