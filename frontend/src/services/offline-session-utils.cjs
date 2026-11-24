const MAX_OFFLINE_SESSION_HOURS = 24;

function tokenExpiresAt(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Number(payload.exp) * 1000;
  } catch {
    return Infinity;
  }
}

function tokenIssuedAt(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const issuedAt = Number(payload.iat) * 1000;
    return Number.isFinite(issuedAt) && issuedAt > 0
      ? new Date(issuedAt).toISOString() : null;
  } catch {
    return null;
  }
}

function offlineSessionExpiresAt(session) {
  const configuredHours = Number(session?.user?.offlineSessionHours) || MAX_OFFLINE_SESSION_HOURS;
  const hours = Math.min(MAX_OFFLINE_SESSION_HOURS, Math.max(1, configuredHours));
  const loginExpiry = Date.parse(session?.loggedInAt) + hours * 60 * 60 * 1000;
  return Math.min(loginExpiry, Number(session?.expiresAt) || Infinity, tokenExpiresAt(session?.token));
}

function offlineSessionIsValid(session, now = Date.now()) {
  const loggedInAt = Date.parse(session?.loggedInAt);
  return Boolean(session?.token && session?.user && Number.isFinite(loggedInAt)
    && now >= loggedInAt && now <= offlineSessionExpiresAt(session));
}

module.exports = {
  MAX_OFFLINE_SESSION_HOURS, offlineSessionExpiresAt, offlineSessionIsValid,
  tokenExpiresAt, tokenIssuedAt,
};
