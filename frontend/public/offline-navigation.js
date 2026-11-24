(function attachOfflineNavigation(root) {
  const POS_URL = '/orders/pos';

  function decideOfflineNavigation(profile, now, url) {
    if (!profile) return { screen: 'sign-in-required', redirectTo: null };
    if (profile.eligible !== true) return { screen: 'offline', redirectTo: null };

    const expiresAt = typeof profile.expiresAt === 'number'
      ? profile.expiresAt : Date.parse(profile.expiresAt);
    if (!Number.isFinite(expiresAt) || now > expiresAt) {
      return { screen: 'sign-in-required', redirectTo: null };
    }

    const pathname = new URL(url, 'https://purebazar.invalid').pathname;
    return {
      screen: 'pos',
      redirectTo: pathname === POS_URL ? null : POS_URL,
    };
  }

  root.decideOfflineNavigation = decideOfflineNavigation;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { decideOfflineNavigation };
  }
}(typeof self === 'undefined' ? globalThis : self));
