import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createCloudItem,
  dedupeCloudItemsByContentHash,
  deleteCloudItem,
  describeCloudError,
  watchAccessibleClipboardItems
} from '../services/cloudClipboardService';
import {
  SYNC_STATES,
  buildDiagnosticsSnapshot,
  buildSyncItem,
  mergeSyncItems,
  removeLocalShadow,
  upsertLocalShadow
} from '../services/clipboardSyncService';

function nowIso() {
  return new Date().toISOString();
}

function legacyKeyFor(baseKey, userUid) {
  return userUid ? `${baseKey}-${userUid}` : '';
}

export function useClipboardSync(user, options = {}) {
  const [cloudItems, setCloudItems] = useState([]);
  // In-memory only: no offline-persistent outbox. The source of truth is Firestore.
  const [localShadows, setLocalShadows] = useState([]);
  const [syncMeta, setSyncMeta] = useState({
    lastSyncAt: '',
    lastError: '',
    listenerState: 'idle',
    backendState: 'idle'
  });
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const bootstrappedRef = useRef(false);
  const flushInFlightRef = useRef(false);
  const syncCooldownUntilRef = useRef(0);
  const dedupeTimerRef = useRef(null);
  const lastDedupeSignatureRef = useRef('');
  const legacyCacheClearedRef = useRef(false);

  const mergedItems = useMemo(
    () => mergeSyncItems(cloudItems, localShadows),
    [cloudItems, localShadows]
  );

  const pendingCount = useMemo(
    () => localShadows.filter((item) => item.pendingSync && !item.deleted).length,
    [localShadows]
  );

  const outbox = useMemo(
    () =>
      localShadows
        .filter((item) => item.pendingSync || item.deleted)
        .map((item) => ({
          mutationId: `${item.deleted ? 'delete' : 'upsert'}-${item.id}`,
          itemId: item.id,
          operation: item.deleted ? 'delete' : 'upsert',
          payload: item
        })),
    [localShadows]
  );

  const diagnostics = useMemo(
    () =>
      buildDiagnosticsSnapshot({
        userUid: user?.uid,
        email: user?.email,
        online: isOnline,
        pendingCount,
        listenerState: syncMeta.listenerState,
        backendState: syncMeta.backendState,
        lastSyncAt: syncMeta.lastSyncAt,
        lastError: syncMeta.lastError,
        outboxSize: outbox.length
      }),
    [isOnline, outbox.length, pendingCount, syncMeta, user?.email, user?.uid]
  );

  const updateSyncMeta = useCallback((patch) => {
    setSyncMeta((prev) => ({ ...prev, ...patch }));
  }, [setSyncMeta]);

  const persistShadow = useCallback((item) => {
    setLocalShadows((prev) => upsertLocalShadow(prev, item));
  }, [setLocalShadows]);

  const syncShadow = useCallback(async (entry) => {
    if (!user?.uid || !isOnline) return false;

    if (entry.deleted) {
      await deleteCloudItem(entry.id);
      setLocalShadows((prev) => removeLocalShadow(prev, entry.id));
      return true;
    }

    const syncingItem = buildSyncItem({
      ...entry,
      ownerId: user.uid,
      ownerEmail: user.email,
      syncState: SYNC_STATES.SYNCING,
      pendingSync: true,
      lastSyncError: ''
    }, {}, { forceStableId: entry.scope === 'local' || entry.syncState === SYNC_STATES.LOCAL });

    persistShadow(syncingItem);

    // Upsert: setDoc(..., { merge: true }) keeps this idempotent and avoids duplicate docs.
    await createCloudItem(
      user,
      {
        ...syncingItem,
        syncState: SYNC_STATES.SYNCED,
        pendingSync: false,
        lastSyncError: ''
      },
      { visibility: syncingItem.visibility || 'personal', scope: 'synced' }
    );

    setLocalShadows((prev) => removeLocalShadow(prev, syncingItem.id));
    return true;
  }, [isOnline, persistShadow, setLocalShadows, user]);

  const flushOutbox = useCallback(async (reason = 'manual') => {
    if (!user?.uid || !isOnline || flushInFlightRef.current) return;
    if (Date.now() < syncCooldownUntilRef.current) return;
    flushInFlightRef.current = true;
    setIsSyncing(true);
    updateSyncMeta({ backendState: 'syncing' });
    let errorOccurred = false;

    try {
      const current = [...localShadows].sort(
        (a, b) => new Date(a.updatedAt || a.createdAt).getTime() - new Date(b.updatedAt || b.createdAt).getTime()
      );

      for (const shadow of current) {
        if (!shadow.pendingSync && !shadow.deleted) continue;
        try {
          await syncShadow(shadow);
          updateSyncMeta({
            lastSyncAt: nowIso(),
            lastError: '',
            backendState: 'connected'
          });
        } catch (error) {
          errorOccurred = true;
          const described = describeCloudError(error);
          // Avoid hammering the network on repeated failures (common on mobile/ad-blocked clients).
          syncCooldownUntilRef.current = Date.now() + 15_000;
          setLocalShadows((prev) =>
            prev.map((item) =>
              item.id === shadow.id
                ? {
                    ...item,
                    syncState: SYNC_STATES.ERROR,
                    pendingSync: false,
                    lastSyncError: described.message,
                    updatedAt: nowIso()
                  }
                : item
            )
          );
          updateSyncMeta({
            lastError: described.message,
            backendState: 'degraded'
          });
          // Stop trying to flush more items if one fails, likely due to a network issue.
          break;
        }
      }
    } finally {
      flushInFlightRef.current = false;
      setIsSyncing(false);
      if (!errorOccurred && reason !== 'listener-retry') {
        updateSyncMeta({ backendState: 'connected' });
      }
    }
  }, [
    isOnline,
    localShadows,
    setLocalShadows,
    syncShadow,
    updateSyncMeta,
    user
  ]);

  const queueUpsert = useCallback((rawItem) => {
    if (!isOnline) {
      const message = 'Offline: sync is online-only. Reconnect to save.';
      updateSyncMeta({ lastError: message, backendState: 'offline' });
      throw new Error(message);
    }
    const shouldForceStableId = rawItem?.scope === 'local' || rawItem?.syncState === SYNC_STATES.LOCAL;
    const nextItem = buildSyncItem({
      ...rawItem,
      ownerId: user?.uid,
      ownerEmail: user?.email,
      syncState: isOnline ? SYNC_STATES.SYNCING : SYNC_STATES.PENDING,
      pendingSync: true,
      lastSyncError: ''
    }, {}, { forceStableId: shouldForceStableId });
    persistShadow(nextItem);
    return nextItem;
  }, [isOnline, persistShadow, updateSyncMeta, user?.email, user?.uid]);

  const saveItem = useCallback(async (rawItem) => {
    const item = queueUpsert(rawItem);
    setIsSyncing(true);
    updateSyncMeta({ backendState: 'syncing' });
    try {
      await syncShadow(item);
      updateSyncMeta({ lastSyncAt: nowIso(), lastError: '', backendState: 'connected' });
    } catch (error) {
      const described = describeCloudError(error);
      setLocalShadows((prev) =>
        prev.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                syncState: SYNC_STATES.ERROR,
                pendingSync: false,
                lastSyncError: described.message,
                updatedAt: nowIso()
              }
            : entry
        )
      );
      updateSyncMeta({ lastError: described.message, backendState: 'degraded' });
      throw error;
    } finally {
      setIsSyncing(false);
    }
    return item;
  }, [queueUpsert, setLocalShadows, syncShadow, updateSyncMeta]);

  const updateItem = useCallback(async (item, patch) => {
    if (!isOnline) {
      const message = 'Offline: sync is online-only. Reconnect to update.';
      updateSyncMeta({ lastError: message, backendState: 'offline' });
      throw new Error(message);
    }
    const nextItem = buildSyncItem({
      ...item,
      ...patch,
      updatedAt: nowIso(),
      ownerId: user?.uid,
      ownerEmail: user?.email
    });
    persistShadow({
      ...nextItem,
      syncState: isOnline ? SYNC_STATES.SYNCING : SYNC_STATES.PENDING,
      pendingSync: true
    });
    setIsSyncing(true);
    updateSyncMeta({ backendState: 'syncing' });
    try {
      await createCloudItem(user, nextItem, { visibility: nextItem.visibility || 'personal', scope: 'synced' });
      setLocalShadows((prev) => removeLocalShadow(prev, nextItem.id));
      updateSyncMeta({ lastSyncAt: nowIso(), lastError: '', backendState: 'connected' });
    } catch (error) {
      const described = describeCloudError(error);
      setLocalShadows((prev) =>
        prev.map((entry) =>
          entry.id === nextItem.id
            ? {
                ...entry,
                syncState: SYNC_STATES.ERROR,
                pendingSync: false,
                lastSyncError: described.message,
                updatedAt: nowIso()
              }
            : entry
        )
      );
      updateSyncMeta({ lastError: described.message, backendState: 'degraded' });
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, persistShadow, setLocalShadows, updateSyncMeta, user]);

  const deleteItem = useCallback(async (item) => {
    if (!item?.id) return;
    if (!isOnline) {
      const message = 'Offline: sync is online-only. Reconnect to delete.';
      updateSyncMeta({ lastError: message, backendState: 'offline' });
      throw new Error(message);
    }
    setIsSyncing(true);
    updateSyncMeta({ backendState: 'syncing' });
    try {
      await deleteCloudItem(item.id);
      updateSyncMeta({ lastSyncAt: nowIso(), lastError: '', backendState: 'connected' });
      setLocalShadows((prev) => removeLocalShadow(prev, item.id));
    } catch (error) {
      const described = describeCloudError(error);
      updateSyncMeta({ lastError: described.message, backendState: 'degraded' });
      persistShadow({
        ...item,
        deleted: true,
        syncState: SYNC_STATES.ERROR,
        pendingSync: false,
        lastSyncError: described.message,
        updatedAt: nowIso()
      });
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, persistShadow, setLocalShadows, updateSyncMeta]);

  const retryFailed = useCallback(async () => {
    if (!isOnline) return;
    setLocalShadows((prev) =>
      prev.map((item) => ({
        ...item,
        pendingSync: true,
        syncState: SYNC_STATES.SYNCING,
        updatedAt: nowIso()
      }))
    );
    await flushOutbox('retry');
  }, [flushOutbox, isOnline, setLocalShadows]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!user?.uid) {
      setCloudItems([]);
      setLocalShadows([]);
      updateSyncMeta({
        listenerState: 'idle',
        backendState: 'signed-out'
      });
      bootstrappedRef.current = false;
      legacyCacheClearedRef.current = false;
      return () => {};
    }

    updateSyncMeta({
      listenerState: 'connecting',
      backendState: 'connecting'
    });

    const stop = watchAccessibleClipboardItems(
      user,
      (items) => {
        setCloudItems(items);
        updateSyncMeta({ listenerState: 'active', backendState: 'connected' });
        if (!bootstrappedRef.current) {
          bootstrappedRef.current = true;
          setIsHydrated(true);
        }

        if (options.dedupeCloud !== false) {
          const counts = new Map();
          for (const entry of items) {
            if (!entry?.contentHash) continue;
            counts.set(entry.contentHash, (counts.get(entry.contentHash) || 0) + 1);
          }
          const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([hash]) => hash).sort();
          const signature = `${user.uid}:${duplicates.join('|')}`;
          if (duplicates.length && signature !== lastDedupeSignatureRef.current) {
            lastDedupeSignatureRef.current = signature;
            if (dedupeTimerRef.current) window.clearTimeout(dedupeTimerRef.current);
            dedupeTimerRef.current = window.setTimeout(() => {
              dedupeCloudItemsByContentHash(user, items).catch(() => {});
            }, 1200);
          }
        }
      },
      (error) => {
        const described = describeCloudError(error);
        updateSyncMeta({
          listenerState: 'error',
          backendState: 'failed',
          lastError: described.message
        });
        if (!bootstrappedRef.current) setIsHydrated(true);
      },
      (state) => updateSyncMeta(state)
    );

    return () => stop();
  }, [options.dedupeCloud, updateSyncMeta, user]);

  useEffect(() => {
    if (!isHydrated && (!user?.uid || !isOnline)) {
      setIsHydrated(true);
    }
  }, [isHydrated, isOnline, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    if (!isOnline) return;
    if (legacyCacheClearedRef.current) return;

    const keyLocal = legacyKeyFor('clipboard-vault-sync-local', user.uid);
    const keyMeta = legacyKeyFor('clipboard-vault-sync-meta', user.uid);
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem?.(keyLocal) : null;

    const drain = async () => {
      let legacy = [];
      try {
        legacy = raw ? JSON.parse(raw) : [];
      } catch {
        legacy = [];
      }

      if (Array.isArray(legacy) && legacy.length) {
        const candidates = legacy.filter((entry) => entry && !entry.deleted);
        await Promise.allSettled(
          candidates.map((entry) =>
            createCloudItem(
              user,
              {
                ...buildSyncItem(entry, { ownerId: user.uid, ownerEmail: user.email }, { forceStableId: true }),
                syncState: SYNC_STATES.SYNCED,
                pendingSync: false,
                lastSyncError: ''
              },
              { visibility: entry.visibility || 'personal', scope: 'synced' }
            )
          )
        );
      }
    };

    drain()
      .catch(() => {})
      .finally(() => {
        try {
          window.localStorage?.removeItem?.(keyLocal);
          window.localStorage?.removeItem?.(keyMeta);
        } catch {
          // ignore
        }
        legacyCacheClearedRef.current = true;
      });
  }, [isOnline, user]);

  useEffect(() => {
    if (!user?.uid || !isOnline) return;
    if (options.autoSyncPending === false) return;
    if (!bootstrappedRef.current) return;
    flushOutbox('auto-online');
  }, [flushOutbox, isOnline, localShadows.length, options.autoSyncPending, user?.uid]);

  return {
    items: mergedItems,
    cloudItems,
    localItems: localShadows,
    outbox,
    diagnostics,
    isOnline,
    isSyncing,
    isHydrated,
    pendingCount,
    syncMeta,
    saveItem,
    updateItem,
    deleteItem,
    retryFailed,
    flushOutbox
  };
}
