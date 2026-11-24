'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import Header from './header';
import Sidebar from './sidebar';
import {
  getCurrentSection, getPageKey, getRoutePermissions, navigationItems,
} from './navigation';
import useAuth from '@/store/use-auth';
import { expireOfflineSession, refreshSession, restoreAuth } from '@/store/auth-slice';
import { useLanguage } from '@/i18n/language-provider';
import { getCurrentPosShift } from '@/services/pos-admin';

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useDispatch();
  const { t } = useLanguage();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const {
    initialized, isAuthenticated, canAccess, user, offlineSessionExpiresAt,
  } = useAuth();
  const canManageShifts = user?.permissions?.includes('*')
    || user?.permissions?.includes('shifts:manage');
  const [online, setOnline] = useState(true);
  const [shiftOpen, setShiftOpen] = useState(false);

  useEffect(() => {
    dispatch(restoreAuth());
  }, [dispatch]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const refresh = () => dispatch(refreshSession()).unwrap().catch((error) => {
      if (error === 0) setOnline(false);
    });
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [dispatch, isAuthenticated]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => {
      dispatch(refreshSession()).unwrap()
        .then(() => setOnline(true))
        .catch((error) => setOnline(error !== 0));
    };
    const onOffline = () => setOnline(false);
    const onNetworkStatus = (event) => setOnline(Boolean(event.detail));
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('purebazar:network-status', onNetworkStatus);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('purebazar:network-status', onNetworkStatus);
    };
  }, [dispatch]);

  useEffect(() => {
    setShiftOpen(false);
    if (!isAuthenticated || !online || !canManageShifts || user?.role === 'Super Admin') return undefined;
    let active = true;
    getCurrentPosShift().then(({ data }) => {
      if (!active) return;
      const open = Boolean(data.shift);
      setShiftOpen(open);
      window.localStorage.setItem(`purebazar.posShiftOpen.${user.id}`, String(open));
    }).catch((error) => {
      if (!error.response) {
        window.dispatchEvent(new CustomEvent('purebazar:network-status', { detail: false }));
      }
      if (active) {
        setShiftOpen(window.localStorage.getItem(`purebazar.posShiftOpen.${user.id}`) === 'true');
      }
    });
    const onShiftState = (event) => {
      const open = Boolean(event.detail);
      setShiftOpen(open);
      window.localStorage.setItem(`purebazar.posShiftOpen.${user.id}`, String(open));
    };
    window.addEventListener('purebazar:shift-state', onShiftState);
    return () => {
      active = false;
      window.removeEventListener('purebazar:shift-state', onShiftState);
    };
  }, [canManageShifts, isAuthenticated, online, user?.id, user?.role]);

  useEffect(() => {
    if (!offlineSessionExpiresAt) return undefined;
    const checkExpiry = () => {
      if (Date.now() >= offlineSessionExpiresAt) {
        dispatch(expireOfflineSession());
        router.replace('/login');
      }
    };
    checkExpiry();
    const timer = window.setInterval(checkExpiry, 30000);
    return () => window.clearInterval(timer);
  }, [dispatch, offlineSessionExpiresAt, router]);

  useEffect(() => {
    if (!initialized) return;
    if (pathname === '/login' && isAuthenticated) router.replace('/dashboard');
    if (pathname !== '/login' && !isAuthenticated) router.replace('/login');
  }, [initialized, isAuthenticated, pathname, router]);

  const hasOtherModulePermission = navigationItems
    .flatMap((item) => item.children || [item])
    .filter((item) => item.href !== '/dashboard' && !item.href.startsWith('/orders/'))
    .some((item) => canAccess(item.permissions, getPageKey(item.href)));
  const posLocked = Boolean(user?.lockCashierToPos
    && user?.role !== 'Super Admin'
    && (!hasOtherModulePermission || shiftOpen));

  useEffect(() => {
    if (posLocked && online && !['/orders/pos', '/orders/shifts'].includes(pathname)) {
      router.replace('/orders/pos');
    }
  }, [online, pathname, posLocked, router]);

  if (!initialized) {
    return <main className="auth-status" role="status">{t('Checking your session...')}</main>;
  }
  if (pathname === '/login') return isAuthenticated ? null : children;
  if (!isAuthenticated) return <main className="auth-status" role="status">{t('Redirecting to sign in...')}</main>;
  if (!online && pathname !== '/orders/pos') {
    return (
      <main className="auth-status">
        <section className="access-denied">
          <h1>Offline</h1>
          <p>This page needs an internet connection. Go back to POS.</p>
          <Link className="mt-4 inline-flex rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white" href="/orders/pos">
            Go back to POS
          </Link>
        </section>
      </main>
    );
  }
  const isAttendanceSelfService = pathname === '/payroll/attendance';
  if (!isAttendanceSelfService && !canAccess(getRoutePermissions(pathname), getPageKey(pathname))) {
    return (
      <main className="auth-status">
        <section className="access-denied">
          <h1>{t('Access denied')}</h1>
          <p>{t('Your role does not have permission to view this page.')}</p>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} posLocked={posLocked} />
      <div className="workspace">
        <Header section={getCurrentSection(pathname)} onMenuClick={() => setSidebarOpen(true)} posLocked={posLocked} />
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}