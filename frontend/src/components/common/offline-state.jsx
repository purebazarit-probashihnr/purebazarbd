'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';
import api from '@/services/api';
import offlineHealthMonitor from '@/services/offline-health-monitor.cjs';
import { T, useLanguage } from '@/i18n/language-provider';

const { createOfflineHealthMonitor } = offlineHealthMonitor;
const NOOP = () => {};

const STATE_TEXT = {
  'offline-unavailable': {
    title: "You're offline",
    body: 'POS needs an internet connection for your account. Offline selling is available only to cashiers and outlet managers. Reconnect and this page will reload automatically.',
  },
  'session-expired': {
    title: 'Sign in required',
    body: 'Your offline session has ended. Connect to the internet and sign in again to continue selling.',
  },
};

export default function OfflineState({
  state = 'offline-unavailable',
  title,
  body,
  showGoToPos = false,
  onReachable = NOOP,
  onUnreachable = NOOP,
}) {
  const { t } = useLanguage();
  const [checking, setChecking] = useState(false);
  const monitorRef = useRef(null);
  const copy = STATE_TEXT[state] || STATE_TEXT['offline-unavailable'];

  const checkHealth = useCallback(async () => {
    const { data } = await api.get('/health', { timeout: 5000 });
    if (data?.status !== 'ok') throw new Error('API health check failed.');
  }, []);

  const reportReachable = useCallback(async () => {
    const result = await onReachable();
    window.dispatchEvent(new CustomEvent('purebazar:network-status', { detail: result !== false }));
    return result;
  }, [onReachable]);

  const reportUnreachable = useCallback((error) => {
    window.dispatchEvent(new CustomEvent('purebazar:network-status', { detail: false }));
    onUnreachable(error);
  }, [onUnreachable]);

  useEffect(() => {
    const monitor = createOfflineHealthMonitor({
      checkHealth,
      onChecking: setChecking,
      onReachable: reportReachable,
      onUnreachable: reportUnreachable,
    });
    monitorRef.current = monitor;
    monitor.setVisible(document.visibilityState === 'visible');
    monitor.start();

    const onOnline = () => { void monitor.retry(); };
    const onVisibilityChange = () => {
      monitor.setVisible(document.visibilityState === 'visible');
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      monitor.stop();
      monitorRef.current = null;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkHealth, reportReachable, reportUnreachable]);

  return (
    <section className="flex min-h-[55vh] items-center justify-center px-4 py-10">
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg shadow-slate-900/5 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/20"
        role="status"
        aria-live="polite"
        aria-busy={checking}
      >
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <WifiOff size={26} aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold text-slate-900 dark:text-slate-100">
          <T>{title || copy.title}</T>
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          <T>{body || copy.body}</T>
        </p>
        <button
          type="button"
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          aria-disabled={checking}
          onClick={() => { void monitorRef.current?.retry(); }}
        >
          <T>{checking ? 'Checking connection…' : 'Try again'}</T>
        </button>
        {showGoToPos && (
          <div>
            <Link
              className="mt-3 inline-flex min-h-10 items-center rounded-lg px-4 py-2 text-sm font-medium text-emerald-800 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:text-emerald-300"
              href="/orders/pos"
            >
              <T>Go to POS</T>
            </Link>
          </div>
        )}
        {state !== 'session-expired' && (
          <p className="mt-5 text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
            <T>{checking ? 'Checking connection…' : 'Waiting for connection…'}</T>
          </p>
        )}
      </div>
    </section>
  );
}
