const { isOfflinePosUser } = require('./offline-pos-access.cjs');

const PROFILE_CACHE = 'purebazar-offline-profile-v1';
const PROFILE_KEY = '/__purebazar_offline_profile__';

function createOfflineProfile(user, loggedInAt = new Date().toISOString()) {
  const hours = Math.min(24, Math.max(1, Number(user?.offlineSessionHours) || 24));
  const loginTime = Date.parse(loggedInAt);
  const expiresAt = new Date((Number.isFinite(loginTime) ? loginTime : Date.now())
    + hours * 60 * 60 * 1000).toISOString();

  return {
    eligible: isOfflinePosUser(user),
    userId: user?.id || user?._id?.toString() || null,
    name: user?.name || null,
    role: user?.role || user?.roleId?.name || null,
    outletId: user?.location?.id || user?.locationId?._id?.toString()
      || user?.locationId?.id || user?.locationId || null,
    outletName: user?.location?.name || user?.locationId?.name || null,
    expiresAt,
  };
}

async function storeOfflineProfile(user, loggedInAt) {
  if (!globalThis.caches || !globalThis.location?.origin) {
    throw new Error('Cache Storage is unavailable for the offline profile.');
  }
  const cache = await caches.open(PROFILE_CACHE);
  const key = new URL(PROFILE_KEY, location.origin);
  const profile = createOfflineProfile(user, loggedInAt);
  await cache.put(key, new Response(JSON.stringify(profile), {
    headers: { 'Content-Type': 'application/json' },
  }));
  return profile;
}

async function clearOfflineProfile() {
  if (!globalThis.caches || !globalThis.location?.origin) return;
  const cache = await caches.open(PROFILE_CACHE);
  await cache.delete(new URL(PROFILE_KEY, location.origin));
}

module.exports = {
  PROFILE_CACHE, PROFILE_KEY, clearOfflineProfile, createOfflineProfile, storeOfflineProfile,
};
