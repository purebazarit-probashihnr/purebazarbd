'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, LogOut, MapPin, Menu, Settings, UserRound } from 'lucide-react';
import useAuth from '@/store/use-auth';
import Button from '@/components/ui/button';
import NotificationBell from './notification-bell';
import LanguageSwitcher from './language-switcher';
import { useLanguage } from '@/i18n/language-provider';
import { getLocations } from '@/services/admin';

export default function Header({ section, onMenuClick }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [outletDropdownOpen, setOutletDropdownOpen] = useState(false);
  const [outlets, setOutlets] = useState([]);
  const [selectedOutlet, setSelectedOutlet] = useState(null);
  const [loadingOutlets, setLoadingOutlets] = useState(false);
  const wrapRef = useRef(null);
  const outletRef = useRef(null);
  const [logoutError, setLogoutError] = useState('');
  const { user, logout, status, canAccess, token } = useAuth();
  const { t } = useLanguage();
  const isSuperAdmin = user?.role === 'Super Admin';

  // Load outlets for Super Admin
  useEffect(() => {
    if (!isSuperAdmin || !token) return;
    let active = true;
    const loadOutlets = async () => {
      try {
        setLoadingOutlets(true);
        const response = await getLocations(token, { type: 'OUTLET' });
        if (active) {
          const outletsList = response.data.locations || [];
          setOutlets(outletsList);
          setSelectedOutlet(null);
        }
      } catch (error) {
        console.error('Failed to load outlets:', error);
      } finally {
        if (active) setLoadingOutlets(false);
      }
    };
    loadOutlets();
    return () => { active = false; };
  }, [isSuperAdmin, token]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setUserMenuOpen(false);
      if (outletRef.current && !outletRef.current.contains(e.target)) setOutletDropdownOpen(false);
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setUserMenuOpen(false);
        setOutletDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  async function handleLogout() {
    setLogoutError('');
    try {
      await logout();
    } catch (error) {
      setLogoutError(typeof error === 'string' ? error : error.message || 'Unable to sign out. Please try again.');
    }
  }

  const getOutletDisplay = () => {
    if (!selectedOutlet) return 'All Outlets';
    const outlet = outlets.find((o) => o.id === selectedOutlet);
    return outlet?.name || 'All Outlets';
  };

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
        {isSuperAdmin && (
          <div className="outlet-switcher" ref={outletRef}>
            <button
              className="outlet-trigger"
              onClick={() => setOutletDropdownOpen(!outletDropdownOpen)}
              disabled={loadingOutlets}
              aria-expanded={outletDropdownOpen}
              aria-haspopup="listbox"
            >
              <MapPin size={16} />
              <span>{getOutletDisplay()}</span>
              <ChevronDown size={14} className={outletDropdownOpen ? 'chevron-up' : ''} />
            </button>
            {outletDropdownOpen && (
              <div className="outlet-dropdown" role="listbox">
                <button
                  className={`outlet-option ${selectedOutlet === null ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedOutlet(null);
                    setOutletDropdownOpen(false);
                  }}
                  role="option"
                  aria-selected={selectedOutlet === null}
                >
                  All Outlets
                </button>
                {outlets.map((outlet) => (
                  <button
                    key={outlet.id}
                    className={`outlet-option ${selectedOutlet === outlet.id ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedOutlet(outlet.id);
                      setOutletDropdownOpen(false);
                    }}
                    role="option"
                    aria-selected={selectedOutlet === outlet.id}
                  >
                    {outlet.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {!isSuperAdmin && user?.assignedLocation && (
          <div className="outlet-badge">
            <MapPin size={14} />
            <span>{user.assignedLocationName || 'Outlet'}</span>
          </div>
        )}
        <LanguageSwitcher />
        {canAccess(['stock:read']) || canAccess(['stock:transfer:read']) ? <NotificationBell /> : null}
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
              {canAccess(['settings:read']) && <Link href="/settings" role="menuitem" className="user-menu-item" onClick={() => setUserMenuOpen(false)}><Settings size={16} />{t('Settings')}</Link>}
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