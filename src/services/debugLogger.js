function canUseBrowserDebug() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function isDebugLoggingEnabled() {
  if (import.meta.env.VITE_DEBUG_CLIPBOARD === 'true') {
    return true;
  }

  if (!canUseBrowserDebug()) {
    return false;
  }

  try {
    return window.localStorage.getItem('clipboard-vault-debug') === 'true';
  } catch {
    return false;
  }
}

export function debugLog(scope, message, details) {
  if (!isDebugLoggingEnabled()) return;

  const prefix = `[clipboard-debug:${scope}] ${message}`;
  if (typeof details === 'undefined') {
    console.log(prefix);
    return;
  }
  console.log(prefix, details);
}

export function debugWarn(scope, message, details) {
  if (!isDebugLoggingEnabled()) return;

  const prefix = `[clipboard-debug:${scope}] ${message}`;
  if (typeof details === 'undefined') {
    console.warn(prefix);
    return;
  }
  console.warn(prefix, details);
}
