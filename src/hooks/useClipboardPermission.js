import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PERMISSION_COPY = {
  unknown: {
    title: 'Clipboard permission unknown',
    help: 'Click "Enable clipboard access" to allow auto capture in this browser.'
  },
  prompt: {
    title: 'Clipboard access needed',
    help: 'Your browser can ask for permission. Click "Enable clipboard access" and allow the prompt.'
  },
  denied: {
    title: 'Clipboard access blocked',
    help: 'Browser blocked clipboard read. Open site settings and allow Clipboard permissions, then retry.'
  },
  unsupported: {
    title: 'Clipboard API limited',
    help: 'This browser limits background clipboard reads. Manual capture still works.'
  },
  granted: {
    title: 'Clipboard access granted',
    help: ''
  }
};

function resolvePermissionState(value) {
  if (value === 'granted' || value === 'prompt' || value === 'denied') return value;
  return 'unknown';
}

async function queryClipboardPermission() {
  if (typeof navigator === 'undefined') return 'unknown';
  if (!navigator.clipboard?.readText) return 'unsupported';
  if (!navigator.permissions?.query) return 'unknown';

  try {
    const result = await navigator.permissions.query({ name: 'clipboard-read' });
    return resolvePermissionState(result.state);
  } catch {
    return 'unknown';
  }
}

export function useClipboardPermission() {
  const [permissionState, setPermissionState] = useState('unknown');
  const statusRef = useRef(null);

  const refreshPermission = useCallback(async () => {
    const next = await queryClipboardPermission();
    setPermissionState(next);
    return next;
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof navigator === 'undefined') {
      setPermissionState('unsupported');
      return false;
    }

    if (!navigator.clipboard?.readText) {
      setPermissionState('unsupported');
      return false;
    }

    try {
      await navigator.clipboard.readText();
      setPermissionState('granted');
      return true;
    } catch {
      const next = await refreshPermission();
      if (next === 'unknown') setPermissionState('denied');
      return false;
    }
  }, [refreshPermission]);

  const markPermissionGranted = useCallback(() => {
    setPermissionState('granted');
  }, []);

  useEffect(() => {
    let active = true;
    let permissionStatus = null;

    const attach = async () => {
      const current = await refreshPermission();
      if (!active) return;

      if (navigator.permissions?.query && current !== 'unsupported') {
        try {
          permissionStatus = await navigator.permissions.query({ name: 'clipboard-read' });
          statusRef.current = permissionStatus;
          permissionStatus.onchange = () => {
            setPermissionState(resolvePermissionState(permissionStatus.state));
          };
        } catch {
          // Browsers can reject this query; keep current state.
        }
      }
    };

    attach();
    return () => {
      active = false;
      if (permissionStatus) permissionStatus.onchange = null;
      statusRef.current = null;
    };
  }, [refreshPermission]);

  const permissionCopy = useMemo(() => PERMISSION_COPY[permissionState] || PERMISSION_COPY.unknown, [permissionState]);

  return {
    permissionState,
    permissionCopy,
    // Auto-capture is only reliable once the browser reports an explicit grant.
    canReadClipboard: permissionState === 'granted',
    markPermissionGranted,
    refreshPermission,
    requestPermission
  };
}
