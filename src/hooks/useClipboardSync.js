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
  createOutboxEntry,
  markMutationFailed,
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
  const [outbox, setOutbox] = useLocalStorage('clipboard-vault-sync-outbox', []);
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
    () => outbox.filter((entry) => entry.operation !== 'delete').length,
    [outbox]
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

  const enqueueMutation = useCallback((operation, item) => {
    const entry = createOutboxEntry(operation, item);
    setOutbox((prev) => {
      const filtered = prev.filter((value) => !(value.itemId === entry.itemId && value.operation === operation));
      return [entry, ...filtered];
    });
    return entry;
  }, [setOutbox]);

  const flushOutbox = useCallback(async (reason = 'manual') => {
    if (!user?.uid || !isOnline || flushInFlightRef.current) return;
    flushInFlightRef.current = true;
    setIsSyncing(true);
    updateSyncMeta({ backendState: 'syncing' });

    try {
      const current = [...outbox].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      for (const entry of current) {
        if (new Date(entry.nextRetryAt || 0).getTime() > Date.now()) continue;

        try {
          if (entry.operation === 'delete') {
            await deleteCloudItem(entry.itemId);
            setLocalShadows((prev) => removeLocalShadow(prev, entry.itemId));
          } else if (entry.operation === 'upsert') {
            const syncingItem = buildSyncItem({
              ...entry.payload,
              syncState: SYNC_STATES.SYNCING,
              pendingSync: true,
              lastSyncError: ''
            });
            persistShadow(syncingItem);

            const cloudPayload = {
              ...syncingItem,
              syncState: SYNC_STATES.SYNCED,
              pendingSync: false,
              lastSyncError: ''
            };

            if (cloudItems.some((item) => item.id === syncingItem.id)) {
              await updateCloudItem(user, syncingItem.id, cloudPayload);
            } else {
              await createCloudItem(user, cloudPayload, { visibility: syncingItem.visibility || 'personal' });
            }

            setLocalShadows((prev) => removeLocalShadow(prev, syncingItem.id));
          }

          setOutbox((prev) => prev.filter((value) => value.mutationId !== entry.mutationId));
          updateSyncMeta({
            lastSyncAt: nowIso(),
            lastError: '',
            backendState: 'connected'
          });
        } catch (error) {
          const described = describeCloudError(error);
          setOutbox((prev) =>
            prev.map((value) =>
              value.mutationId === entry.mutationId ? markMutationFailed(value, described) : value
            )
          );
          setLocalShadows((prev) =>
            prev.map((item) =>
              item.id === entry.itemId
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
      if (reason !== 'listener-retry' && outbox.length === 0) {
        updateSyncMeta({ backendState: 'connected' });
      }
    }
  }, [
    cloudItems,
    isOnline,
    outbox,
    persistShadow,
    setLocalShadows,
    setOutbox,
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
    enqueueMutation('upsert', nextItem);
    return nextItem;
  }, [enqueueMutation, isOnline, persistShadow, user?.email, user?.uid]);

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
    enqueueMutation('upsert', nextItem);
    if (isOnline) {
      await flushOutbox('update');
    }
  }, [enqueueMutation, flushOutbox, isOnline, persistShadow, user?.email, user?.uid]);

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
    enqueueMutation('delete', { id: item.id });
    if (isOnline) {
      await flushOutbox('delete');
    }
  }, [enqueueMutation, flushOutbox, isOnline, setLocalShadows]);

  const retryFailed = useCallback(async () => {
    setOutbox((prev) =>
      prev.map((entry) => ({
        ...entry,
        nextRetryAt: nowIso(),
        updatedAt: nowIso()
      }))
    );
    await flushOutbox('retry');
  }, [flushOutbox, setOutbox]);

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
  }, [flushOutbox, isOnline, options.autoSyncPending, outbox.length, user?.uid]);

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
