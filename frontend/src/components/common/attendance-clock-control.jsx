'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { clockIn, clockOut, getMyAttendance } from '@/services/payroll';

export default function AttendanceClockControl({ token, compact = false }) {
  const [employee, setEmployee] = useState(null);
  const [openRecord, setOpenRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    getMyAttendance(token).then(({ data }) => {
      if (!active) return;
      setEmployee(data.employee);
      setOpenRecord(data.openRecord);
    }).catch((requestError) => {
      if (!navigator.onLine || !requestError.response) return;
      if (active) setError(requestError.response?.data?.message || 'Unable to load attendance status.');
    });
    return () => { active = false; };
  }, [token]);

  async function punch(action) {
    setBusy(true);
    setError('');
    try {
      const { data } = await (action === 'in' ? clockIn(token) : clockOut(token));
      setOpenRecord(action === 'in' ? data.record : null);
    } catch (requestError) {
      if (!navigator.onLine || !requestError.response) return;
      setError(requestError.response?.data?.message || 'Unable to record attendance.');
    } finally {
      setBusy(false);
    }
  }

  if (!employee) return error ? <span role="alert" className="text-xs text-red-700">{error}</span> : null;
  return (
    <div className={compact ? 'flex items-center gap-2' : 'flex flex-wrap items-center gap-3'}>
      {compact && <Link href="/payroll/attendance" className="text-xs font-medium text-slate-600">Attendance</Link>}
      {!compact && <span className="text-sm text-slate-600">{employee.name}</span>}
      <Button size="sm" variant={openRecord ? 'secondary' : 'primary'} disabled={busy || Boolean(openRecord)} onClick={() => punch('in')}>
        {busy && !openRecord ? 'Working...' : 'Clock in'}
      </Button>
      <Button size="sm" variant="secondary" disabled={busy || !openRecord} onClick={() => punch('out')}>
        {busy && openRecord ? 'Working...' : 'Clock out'}
      </Button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
