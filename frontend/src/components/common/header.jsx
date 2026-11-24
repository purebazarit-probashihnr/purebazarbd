'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, LogOut, Menu, Settings, UserRound } from 'lucide-react';
import useAuth from '@/store/use-auth';
import Button from '@/components/ui/button';
import NotificationBell from './notification-bell';
import LanguageSwitcher from './language-switcher';
import { useLanguage } from '@/i18n/language-provider';
import { getDashboardLocations } from '@/services/dashboard';
import AttendanceClockControl from './attendance-clock-control';

const DASHBOARD_LOCATION_KEY = 'purebazar.dashboardLocationId';

export default function Header({ section, onMenuClick, posLocked = false }) {
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const wrapRef = useRef(null);
  const [logoutError, setLogoutError] = useState('');
  const { user, token, logout, status, canAccess } = useAuth();
  const { t } = useLanguage();
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('all');
  const [locationError, setLocationError] = useState('');
  const isSuperAdmin = user?.role === 'Super Admin';
  const canViewAllLocations = isSuperAdmin || Boolean(user?.canViewAllLocations);

  useEffect(() => {
    if (!canViewAllLocations || !token) {
      setLocations([]);
      setLocationError('');
      return undefined;
    }
    setLocationId(window.sessionStorage.getItem(DASHBOARD_LOCATION_KEY) || 'all');
    setLocationError('');
    let active = true;
    getDashboardLocations(token)
      .then(({ data }) => {
        if (active) setLocations((data.locations || []).filter((location) => (
          location.isActive && ['CENTRAL', 'OUTLET'].includes(location.type)
        )));
      })
      .catch(() => {
        if (active) setLocationError(t('Unable to load locations.'));
      });
    return () => { active = false; };
  }, [canViewAllLocations, t, token]);

  function changeLocation(event) {
    const selected = event.target.value;
    setLocationId(selected);
    window.sessionStorage.setItem(DASHBOARD_LOCATION_KEY, selected);
    window.dispatchEvent(new CustomEvent('purebazar:dashboard-location-change', { detail: selected }));
  }

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setUserMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setUserMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [userMenuOpen]);

  async function handleLogout() {
    setLogoutError('');
    try {
      await logout();
    } catch (error) {
      setLogoutError(typeof error === 'string' ? error : error.message || 'Unable to sign out. Please try again.');
    }
  }

  return (
    <header className="app-header">
      <div className="header-leading">
        <button className="icon-button mobile-menu" aria-label={t('Open navigation')} onClick={onMenuClick}>
          <Menu size={21} />
        </button>
        <div className="header-context">
          <span className="header-eyebrow">PUREBAZAR</span>
          <span className="header-section">{t(section)}</span>
        </div>
      </div>
      <div className="header-actions">
      {posLocked ? (
        <nav className="flex items-center gap-2" aria-label={t('POS navigation')}>
          <Link className="rounded-md px-2 py-1 text-sm font-medium hover:bg-slate-100" href="/orders/pos">{t('POS')}</Link>
          <Link className="rounded-md px-2 py-1 text-sm font-medium hover:bg-slate-100" href="/orders/shifts">{t('Cashier Shift')}</Link>
        </nav>
      ) : null}
      {!posLocked && (canViewAllLocations && pathname === '/dashboard' ? (
        <>
          <label className="header-location">
            <span className="sr-only">{t('Dashboard location')}</span>
            <select aria-label={t('Dashboard location')} value={locationId} onChange={changeLocation}>
              <option value="all">{t('All')}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </label>
          {locationError && <span className="header-location-error" role="alert">{locationError}</span>}
        </>
      ) : user?.location?.name ? (
        <span className="header-location-readonly" aria-label={t('Location')}>
          {user.location.name}
        </span>
      ) : null)}
      {!posLocked && <AttendanceClockControl token={token} compact />}
      {!posLocked && <LanguageSwitcher />}
      {!posLocked && (canAccess(['stock:read']) || canAccess(['stock:transfer:read']) ? <NotificationBell /> : null)}
      <div className="user-menu-wrap" ref={wrapRef}>
        <button
          className="user-menu-trigger"
          aria-expanded={userMenuOpen}
          aria-haspopup="menu"
          onClick={() => setUserMenuOpen((open) => !open)}
        >
          <span className="user-avatar"><UserRound size={18} /></span>
          <span className="user-details"><strong>{user?.name || user?.email}</strong><small>{user?.role || 'Staff'}</small></span>
          <ChevronDown size={16} className={userMenuOpen ? 'chevron-up' : ''} />
        </button>
        {userMenuOpen && (
          <div className="user-menu" role="menu">
            <div className="user-menu-info">
              <span className="user-menu-avatar"><UserRound size={20} /></span>
              <div className="user-menu-who"><strong>{user?.name || user?.email}</strong><span className="user-role-badge">{user?.role || 'Staff'}</span></div>
            </div>
            {logoutError && <p className="user-menu-error" role="alert">{logoutError}</p>}
            {!posLocked && canAccess(['settings:read']) && <Link href="/settings" role="menuitem" className="user-menu-item" onClick={() => setUserMenuOpen(false)}><Settings size={16} />{t('Settings')}</Link>}
            <Button className="user-menu-logout" variant="ghost" size="sm" role="menuitem" disabled={status === 'loading'} onClick={handleLogout}>
              <LogOut size={16} />{t(status === 'loading' ? 'Signing out...' : 'Sign out')}
            </Button>
          </div>
        )}
      </div>
      </div>
    </header>
  );
}