import { normalizeItem } from '../features/clipboard/model';
import { normalizeClipboardText, quickHashText } from '../utils/hash';

export const SYNC_STATES = {
  LOCAL: 'local',
  PENDING: 'pending',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  ERROR: 'error'
};

const RETRY_STEPS_MS = [1500, 4000, 9000, 20000, 45000];

export function formatSyncError(error) {
  const code = error?.code || error?.name || 'unknown';
  const message = error?.message || 'Unknown sync error.';
  return { code, message: `${code}: ${message}` };
}

export function getRetryDelayMs(retries = 0) {
  return RETRY_STEPS_MS[Math.min(RETRY_STEPS_MS.length - 1, Math.max(0, retries))];
}

export function buildStableItemId(ownerId, contentHash) {
  return quickHashText(`${ownerId || 'anonymous'}:${contentHash || 'empty'}`);
}

export function buildMutationId(itemId, operation, timestamp = Date.now()) {
  return `${operation}-${itemId}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createOutboxEntry(operation, item, now = new Date().toISOString()) {
  return {
    mutationId: buildMutationId(item.id, operation),
    itemId: item.id,
    operation,
    payload: item,
    retries: 0,
    nextRetryAt: now,
    createdAt: now,
    updatedAt: now,
    lastError: ''
  };
}

export function buildSyncItem(rawItem, defaults = {}) {
  const normalized = normalizeItem(rawItem, defaults);
  const normalizedText =
    normalized.kind === 'text'
      ? normalizeClipboardText(normalized.content)
      : `${normalized.kind}:${normalized.preview || normalized.content}`;
  const contentHash = normalized.contentHash || quickHashText(normalizedText);
  const itemId = normalized.id || buildStableItemId(normalized.ownerId || defaults.ownerId, contentHash);

  return normalizeItem(
    {
      ...normalized,
      id: itemId,
      contentHash,
      syncState: normalized.syncState || SYNC_STATES.LOCAL,
      pendingSync: Boolean(normalized.pendingSync),
      lastSyncError: normalized.lastSyncError || ''
    },
    defaults
  );
}

export function upsertLocalShadow(shadows = [], nextItem) {
  const filtered = shadows.filter((item) => item.id !== nextItem.id);
  return [nextItem, ...filtered];
}

export function removeLocalShadow(shadows = [], itemId) {
  return shadows.filter((item) => item.id !== itemId);
}

export function markMutationFailed(entry, error) {
  const formatted = formatSyncError(error);
  const retries = Number(entry.retries || 0) + 1;
  return {
    ...entry,
    retries,
    lastError: formatted.message,
    updatedAt: new Date().toISOString(),
    nextRetryAt: new Date(Date.now() + getRetryDelayMs(retries)).toISOString()
  };
}

export function mergeSyncItems(cloudItems = [], localShadows = []) {
  const deletedIds = new Set(
    localShadows.filter((item) => item.deleted).map((item) => item.id)
  );
  const byId = new Map();

  cloudItems.forEach((item) => {
    if (!deletedIds.has(item.id)) {
      byId.set(item.id, normalizeItem({ ...item, syncState: SYNC_STATES.SYNCED, pendingSync: false }));
    }
  });

  localShadows.forEach((item) => {
    if (item.deleted) {
      byId.delete(item.id);
      return;
    }
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, normalizeItem(item));
      return;
    }

    const existingTs = new Date(existing.updatedAt || existing.createdAt).getTime();
    const localTs = new Date(item.updatedAt || item.createdAt).getTime();
    byId.set(
      item.id,
      normalizeItem({
        ...(localTs >= existingTs ? existing : item),
        ...(localTs >= existingTs ? item : existing),
        syncState: item.syncState || existing.syncState || SYNC_STATES.SYNCED,
        pendingSync: Boolean(item.pendingSync),
        lastSyncError: item.lastSyncError || ''
      })
    );
  });

  return [...byId.values()].sort(
    (a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() -
      new Date(a.updatedAt || a.createdAt).getTime()
  );
}

export function buildDiagnosticsSnapshot(state = {}) {
  return {
    userUid: state.userUid || '',
    email: state.email || '',
    online: Boolean(state.online),
    pendingCount: Number(state.pendingCount || 0),
    listenerState: state.listenerState || 'idle',
    backendState: state.backendState || 'unknown',
    lastSyncAt: state.lastSyncAt || '',
    lastError: state.lastError || '',
    outboxSize: Number(state.outboxSize || 0)
  };
}
