function getPosScreenState({
  browserOnline,
  apiReachable,
  userLoaded,
  isOfflinePosUser,
  hasPosPermission,
  offlineSessionValid,
}) {
  if (!browserOnline || !apiReachable) {
    if (!userLoaded || !isOfflinePosUser) return 'offline-unavailable';
    return offlineSessionValid ? 'ready' : 'session-expired';
  }
  if (!userLoaded) return 'offline-unavailable';
  return hasPosPermission ? 'ready' : 'no-permission';
}

module.exports = { getPosScreenState };
