import { beforeEach, describe, expect, it, vi } from 'vitest';
import { debugLog, debugWarn, isDebugLoggingEnabled } from './debugLogger';

function makeStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    clear() {
      store.clear();
    }
  };
}

describe('debugLogger', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.stubEnv('VITE_DEBUG_CLIPBOARD', 'false');
    Object.defineProperty(globalThis, 'window', {
      value: {
        localStorage: makeStorage()
      },
      configurable: true
    });
  });

  it('enables logs from localStorage flag', () => {
    window.localStorage.setItem('clipboard-vault-debug', 'true');
    expect(isDebugLoggingEnabled()).toBe(true);
  });

  it('writes debug logs only when enabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    debugLog('sync', 'hidden');
    expect(logSpy).not.toHaveBeenCalled();

    window.localStorage.setItem('clipboard-vault-debug', 'true');
    debugLog('sync', 'visible', { pending: 1 });
    expect(logSpy).toHaveBeenCalledWith('[clipboard-debug:sync] visible', { pending: 1 });
  });

  it('writes debug warnings only when enabled', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    window.localStorage.setItem('clipboard-vault-debug', 'true');
    debugWarn('capture', 'failed', { reason: 'denied' });
    expect(warnSpy).toHaveBeenCalledWith('[clipboard-debug:capture] failed', { reason: 'denied' });
  });
});
