import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import {
  createCloudItem,
  deleteCloudItem,
  describeCloudError,
  updateCloudItem,
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

export function useClipboardSync(user, options = {}) {
  const [cloudItems, setCloudItems] = useState([]);
  const [localShadows, setLocalShadows] = useLocalStorage('clipboard-vault-sync-local', []);
  const [syncMeta, setSyncMeta] = useLocalStorage('clipboard-vault-sync-meta', {
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
    });

    persistShadow(syncingItem);

    if (cloudItems.some((item) => item.id === syncingItem.id)) {
      await updateCloudItem(user, syncingItem.id, {
        ...syncingItem,
        syncState: SYNC_STATES.SYNCED,
        pendingSync: false,
        lastSyncError: ''
      });
    } else {
      await createCloudItem(
        user,
        {
          ...syncingItem,
          syncState: SYNC_STATES.SYNCED,
          pendingSync: false,
          lastSyncError: ''
        },
        { visibility: syncingItem.visibility || 'personal' }
      );
    }

    setLocalShadows((prev) => removeLocalShadow(prev, syncingItem.id));
    return true;
  }, [cloudItems, isOnline, persistShadow, setLocalShadows, user]);

  const flushOutbox = useCallback(async (reason = 'manual') => {
    if (!user?.uid || !isOnline || flushInFlightRef.current) return;
    flushInFlightRef.current = true;
    setIsSyncing(true);
    updateSyncMeta({ backendState: 'syncing' });

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
          const described = describeCloudError(error);
          setLocalShadows((prev) =>
            prev.map((item) =>
              item.id === shadow.id
                ? {
                    ...item,
                    syncState: SYNC_STATES.ERROR,
                    pendingSync: true,
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
        }
      }
    } finally {
      flushInFlightRef.current = false;
      setIsSyncing(false);
      if (reason !== 'listener-retry') {
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
    const nextItem = buildSyncItem({
      ...rawItem,
      ownerId: user?.uid,
      ownerEmail: user?.email,
      syncState: isOnline ? SYNC_STATES.SYNCING : SYNC_STATES.PENDING,
      pendingSync: true,
      lastSyncError: ''
    });
    persistShadow(nextItem);
    return nextItem;
  }, [isOnline, persistShadow, user?.email, user?.uid]);

  const saveItem = useCallback(async (rawItem) => {
    const item = queueUpsert(rawItem);
    if (isOnline) {
      await flushOutbox('save');
    }
    return item;
  }, [flushOutbox, isOnline, queueUpsert]);

  const updateItem = useCallback(async (item, patch) => {
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
    if (isOnline) {
      await flushOutbox('update');
    }
  }, [flushOutbox, isOnline, persistShadow, user?.email, user?.uid]);

  const deleteItem = useCallback(async (item) => {
    if (!item?.id) return;
    setLocalShadows((prev) =>
      upsertLocalShadow(prev, {
        ...item,
        deleted: true,
        syncState: isOnline ? SYNC_STATES.SYNCING : SYNC_STATES.PENDING,
        pendingSync: true,
        updatedAt: nowIso()
      })
    );
    if (isOnline) {
      await flushOutbox('delete');
    }
  }, [flushOutbox, isOnline, setLocalShadows]);

  const retryFailed = useCallback(async () => {
    setLocalShadows((prev) =>
      prev.map((item) => ({
        ...item,
        pendingSync: true,
        syncState: isOnline ? SYNC_STATES.SYNCING : SYNC_STATES.PENDING,
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
      updateSyncMeta({
        listenerState: 'idle',
        backendState: 'signed-out'
      });
      bootstrappedRef.current = false;
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
  }, [updateSyncMeta, user]);

  useEffect(() => {
    if (!isHydrated && (!user?.uid || !isOnline)) {
      setIsHydrated(true);
    }
  }, [isHydrated, isOnline, user?.uid]);

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
