'use client';

export default function OfflineSyncStatus({
  online, count, syncing, results, queuedBills = [],
}) {
  const seen = new Set(results.map((result) => result.offlineNumber));
  const failedBills = queuedBills
    .filter((bill) => bill.lastError && !seen.has(bill.offlineNumber))
    .map((bill) => ({
      offlineNumber: bill.offlineNumber, status: 'failed', detail: bill.lastError,
    }));
  const visibleResults = [...results, ...failedBills];
  return (
    <>
      <span className={`rounded-full px-3 py-2 text-sm font-semibold ${online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`} role="status">
        {online ? 'Online' : 'Offline'} · {count} unsynced bill{count === 1 ? '' : 's'}
      </span>
      {visibleResults.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-3 text-sm" aria-live="polite">
          <h2 className="font-semibold">Offline bill sync {syncing ? 'in progress' : 'results'}</h2>
          <ul className="mt-2 space-y-1">
            {visibleResults.map((result, index) => (
              <li key={`${result.offlineNumber}-${index}`} className="flex flex-wrap gap-2">
                <strong className={result.status === 'failed' ? 'text-red-700' : result.status === 'flagged' ? 'text-amber-800' : 'text-emerald-800'}>
                  {result.status}
                </strong>
                <span>{result.offlineNumber}</span>
                {result.detail && <span className="text-slate-600">{result.detail}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
