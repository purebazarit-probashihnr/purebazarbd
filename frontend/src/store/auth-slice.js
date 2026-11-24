import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import api, { setAuthToken } from '@/services/api';
import {
  offlineSessionExpiresAt, offlineSessionIsValid, tokenExpiresAt,
} from '@/services/offline-session-utils.cjs';
import offlinePosAccess from '@/services/offline-pos-access.cjs';

const { isOfflinePosUser } = offlinePosAccess;

const OFFLINE_SESSION_KEY = 'purebazar.offlineSession';

function readOfflineSession() {
  try {
    return JSON.parse(window.localStorage.getItem(OFFLINE_SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeOfflineSession(session) {
  window.localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(session));
}

const initialState = {
  user: null,
  token: null,
  isAuthenticated: false,
  initialized: false,
  status: 'idle',
  error: null,
  offlineSession: false,
  offlineSessionValid: false,
  offlineSessionExpiresAt: null,
};

export const restoreAuth = createAsyncThunk('auth/restore', async (_, { rejectWithValue }) => {
  const cachedSession = readOfflineSession();
  if (cachedSession?.user && !isOfflinePosUser(cachedSession.user)) {
    window.localStorage.removeItem(OFFLINE_SESSION_KEY);
  }
  const token = window.sessionStorage.getItem('purebazar.authToken') || cachedSession?.token;
  if (!token) {
    setAuthToken(null);
    return null;
  }

  setAuthToken(token);
  try {
    const { data } = await api.get('/auth/me');
    let restoredOfflineExpiresAt = null;
    if (isOfflinePosUser(data.user)) {
      const session = {
        ...cachedSession,
        token,
        user: data.user,
        loggedInAt: cachedSession?.loggedInAt || new Date().toISOString(),
      };
      if (!session.expiresAt) session.expiresAt = offlineSessionExpiresAt(session);
      writeOfflineSession(session);
      restoredOfflineExpiresAt = offlineSessionExpiresAt(session);
    } else {
      window.localStorage.removeItem(OFFLINE_SESSION_KEY);
    }
    window.sessionStorage.setItem('purebazar.authToken', token);
    window.dispatchEvent(new CustomEvent('purebazar:network-status', { detail: true }));
    return {
      token,
      user: data.user,
      offline: false,
      offlineExpiresAt: restoredOfflineExpiresAt,
      offlineSessionValid: isOfflinePosUser(data.user)
        && offlineSessionIsValid({
          ...cachedSession,
          token,
          user: data.user,
          loggedInAt: cachedSession?.loggedInAt || new Date().toISOString(),
        }),
    };
  } catch (error) {
    if (error.response?.status === 401) {
      window.localStorage.removeItem(OFFLINE_SESSION_KEY);
      window.sessionStorage.removeItem('purebazar.authToken');
      setAuthToken(null);
      return null;
    }
    if (error.response && error.response.status < 500) {
      setAuthToken(null);
      window.sessionStorage.removeItem('purebazar.authToken');
      window.localStorage.removeItem(OFFLINE_SESSION_KEY);
      return rejectWithValue(error.response.data?.message || 'Unable to verify your session.');
    }
    window.dispatchEvent(new CustomEvent('purebazar:network-status', { detail: false }));
    const cachedOfflineUser = isOfflinePosUser(cachedSession?.user);
    return {
      token,
      user: cachedOfflineUser ? cachedSession.user : null,
      offline: true,
      offlineExpiresAt: cachedOfflineUser ? offlineSessionExpiresAt(cachedSession) : null,
      offlineSessionValid: cachedOfflineUser && offlineSessionIsValid(cachedSession),
    };
  }
});

// Silently re-reads the user's role/permissions so role edits apply without re-login.
export const refreshSession = createAsyncThunk('auth/refresh', async (_, { rejectWithValue }) => {
  try {
    const { data } = await api.get('/auth/me');
    return data.user;
  } catch (error) {
    return rejectWithValue(error.response?.status || 0);
  }
});

export const loginUser = createAsyncThunk('auth/login', async (credentials, { rejectWithValue }) => {
  try {
    const { data } = await api.post('/auth/login', credentials);
    setAuthToken(data.token);
    window.sessionStorage.setItem('purebazar.authToken', data.token);
    if (isOfflinePosUser(data.user)) {
      writeOfflineSession({
        token: data.token,
        user: data.user,
        loggedInAt: new Date().toISOString(),
        expiresAt: tokenExpiresAt(data.token),
      });
    } else {
      window.localStorage.removeItem(OFFLINE_SESSION_KEY);
    }
    return data;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || 'Unable to sign in. Check your connection and try again.');
  }
});

export const logoutUser = createAsyncThunk('auth/logout', async (_, { getState, rejectWithValue }) => {
  try {
    const token = getState().auth.token;
    await api.post('/auth/logout', null, { headers: { Authorization: `Bearer ${token}` } });
    setAuthToken(null);
    window.localStorage.removeItem(OFFLINE_SESSION_KEY);
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || 'Unable to sign out. Please try again.');
  }
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearAuthError(state) {
      state.error = null;
      if (state.status === 'failed') state.status = 'idle';
    },
    offlineSessionExpired() {
      return { ...initialState, initialized: true };
    },
    markOfflineSessionExpired(state) {
      state.offlineSessionValid = false;
    },
  },
  extraReducers(builder) {
    builder
      .addCase(restoreAuth.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(restoreAuth.fulfilled, (state, action) => {
        state.initialized = true;
        state.status = action.payload ? 'succeeded' : 'idle';
        state.user = action.payload?.user || null;
        state.token = action.payload?.token || null;
        state.isAuthenticated = Boolean(action.payload);
        state.offlineSession = Boolean(action.payload?.offline);
        state.offlineSessionValid = Boolean(action.payload?.offlineSessionValid);
        state.offlineSessionExpiresAt = action.payload?.offlineExpiresAt || null;
      })
      .addCase(restoreAuth.rejected, (state, action) => {
        state.initialized = true;
        state.status = 'failed';
        state.error = action.payload || action.error.message;
      })
      .addCase(refreshSession.fulfilled, (state, action) => {
        if (state.isAuthenticated && action.payload) {
          state.user = action.payload;
          const cachedSession = readOfflineSession();
          if (!isOfflinePosUser(action.payload)) {
            window.localStorage.removeItem(OFFLINE_SESSION_KEY);
            state.offlineSession = false;
            state.offlineSessionValid = false;
            state.offlineSessionExpiresAt = null;
          } else {
            const refreshedSession = cachedSession
              ? { ...cachedSession, user: action.payload }
              : null;
            if (refreshedSession) writeOfflineSession(refreshedSession);
            state.offlineSession = false;
            state.offlineSessionValid = Boolean(
              refreshedSession && offlineSessionIsValid(refreshedSession),
            );
            state.offlineSessionExpiresAt = refreshedSession
              ? offlineSessionExpiresAt(refreshedSession)
              : null;
          }
        }
      })
      .addCase(refreshSession.rejected, (state, action) => {
        if (action.payload === 401) {
          window.sessionStorage.removeItem('purebazar.authToken');
          window.localStorage.removeItem(OFFLINE_SESSION_KEY);
          return { ...initialState, initialized: true };
        }
        return state;
      })
      .addCase(loginUser.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(loginUser.fulfilled, (state, action) => {
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.isAuthenticated = true;
        state.initialized = true;
        state.status = 'succeeded';
        state.error = null;
        state.offlineSession = false;
        const session = readOfflineSession();
        state.offlineSessionValid = offlineSessionIsValid(session);
        state.offlineSessionExpiresAt = offlineSessionExpiresAt(session);
      })
      .addCase(loginUser.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload || action.error.message;
      })
      .addCase(logoutUser.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(logoutUser.fulfilled, () => ({ ...initialState, initialized: true }))
      .addCase(logoutUser.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload || action.error.message;
      });
  },
});

export const expireOfflineSession = () => (dispatch) => {
  window.localStorage.removeItem(OFFLINE_SESSION_KEY);
  window.sessionStorage.removeItem('purebazar.authToken');
  setAuthToken(null);
  dispatch(authSlice.actions.offlineSessionExpired());
};

export const { clearAuthError, markOfflineSessionExpired } = authSlice.actions;
export default authSlice.reducer;