function createOfflineHealthMonitor({
  checkHealth,
  onChecking = () => {},
  onReachable = () => {},
  onUnreachable = () => {},
  intervalMs = 4000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let active = false;
  let visible = true;
  let checking = false;
  let previouslyReachable = false;
  let timer = null;

  async function check() {
    if (!active || !visible || checking) return false;
    checking = true;
    onChecking(true);
    try {
      await checkHealth();
    } catch (error) {
      previouslyReachable = false;
      onUnreachable(error);
      return false;
    } finally {
      checking = false;
      onChecking(false);
    }

    if (!previouslyReachable) {
      const reachable = await onReachable();
      previouslyReachable = reachable !== false;
      if (!previouslyReachable) onUnreachable(new Error('Account could not be refreshed.'));
    }
    return previouslyReachable;
  }

  function stopPolling() {
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
  }

  function startPolling() {
    if (!active || !visible || timer !== null) return;
    void check();
    timer = setIntervalFn(check, intervalMs);
  }

  return {
    start() {
      active = true;
      startPolling();
    },
    retry: check,
    setVisible(nextVisible) {
      visible = Boolean(nextVisible);
      if (visible) startPolling();
      else stopPolling();
    },
    stop() {
      active = false;
      stopPolling();
    },
  };
}

module.exports = { createOfflineHealthMonitor };
