import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { getPosScreenState } = require('../src/services/pos-screen-state.cjs');
const { createOfflineHealthMonitor } = require('../src/services/offline-health-monitor.cjs');

test('POS screen state covers offline eligibility, session and online permission states', () => {
  const common = {
    browserOnline: false,
    apiReachable: false,
    userLoaded: true,
    isOfflinePosUser: true,
    hasPosPermission: true,
    offlineSessionValid: true,
  };

  assert.equal(getPosScreenState({
    ...common, isOfflinePosUser: false, offlineSessionValid: false,
  }), 'offline-unavailable');
  assert.equal(getPosScreenState(common), 'ready');
  assert.equal(getPosScreenState({
    ...common, offlineSessionValid: false,
  }), 'session-expired');
  assert.equal(getPosScreenState({
    ...common, userLoaded: false, isOfflinePosUser: false,
  }), 'offline-unavailable');
  assert.equal(getPosScreenState({
    ...common, browserOnline: true, apiReachable: true, hasPosPermission: false,
  }), 'no-permission');
  assert.equal(getPosScreenState({
    ...common, browserOnline: true, apiReachable: true,
  }), 'ready');
});

test('OfflineState retries health and returns automatically when connectivity recovers', async () => {
  let healthAvailable = false;
  let intervalCallback;
  let onReachableCount = 0;
  let onUnreachableCount = 0;
  let screenState = 'offline-unavailable';
  const checking = [];
  const monitor = createOfflineHealthMonitor({
    checkHealth: async () => {
      if (!healthAvailable) throw new Error('offline');
    },
    onChecking: (value) => checking.push(value),
    onReachable: () => {
      onReachableCount += 1;
      screenState = 'ready';
    },
    onUnreachable: () => {
      onUnreachableCount += 1;
      screenState = 'offline-unavailable';
    },
    setIntervalFn: (callback) => {
      intervalCallback = callback;
      return 1;
    },
    clearIntervalFn: () => {},
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  monitor.start();
  await settle();
  assert.equal(onUnreachableCount, 1);

  healthAvailable = true;
  await monitor.retry();
  assert.equal(onReachableCount, 1);
  assert.equal(screenState, 'ready');

  healthAvailable = false;
  await intervalCallback();
  healthAvailable = true;
  await intervalCallback();
  assert.equal(onReachableCount, 2);
  assert.equal(screenState, 'ready');
  assert.ok(checking.includes(true));
  assert.ok(checking.includes(false));
  monitor.stop();

  const component = readFileSync(
    new URL('../src/components/common/offline-state.jsx', import.meta.url),
    'utf8',
  );
  assert.match(component, /monitorRef\.current\?\.retry\(\)/);
  assert.match(component, /window\.addEventListener\('online', onOnline\)/);
  assert.match(component, /monitor\.setVisible\(document\.visibilityState === 'visible'\)/);
});
