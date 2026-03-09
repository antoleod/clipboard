import { describe, expect, it } from 'vitest';
import {
  SYNC_STATES,
  buildStableItemId,
  createOutboxEntry,
  getRetryDelayMs,
  mergeSyncItems
} from './clipboardSyncService';

describe('clipboardSyncService', () => {
  it('builds deterministic ids from user and content hash', () => {
    expect(buildStableItemId('user-1', 'hash-1')).toBe(buildStableItemId('user-1', 'hash-1'));
    expect(buildStableItemId('user-1', 'hash-1')).not.toBe(buildStableItemId('user-2', 'hash-1'));
  });

  it('creates a persistent outbox entry shape', () => {
    const entry = createOutboxEntry('upsert', { id: 'item-1' }, '2026-03-09T00:00:00.000Z');
    expect(entry.operation).toBe('upsert');
    expect(entry.itemId).toBe('item-1');
    expect(entry.retries).toBe(0);
  });

  it('increases retry delays with backoff', () => {
    expect(getRetryDelayMs(0)).toBeLessThan(getRetryDelayMs(3));
  });

  it('prefers local shadow status over cloud snapshot for pending items', () => {
    const merged = mergeSyncItems(
      [{ id: 'item-1', content: 'cloud', createdAt: '2026-03-09T10:00:00.000Z', updatedAt: '2026-03-09T10:00:00.000Z', syncState: SYNC_STATES.SYNCED }],
      [{ id: 'item-1', content: 'local', createdAt: '2026-03-09T10:01:00.000Z', updatedAt: '2026-03-09T10:01:00.000Z', pendingSync: true, syncState: SYNC_STATES.PENDING }]
    );
    expect(merged[0].content).toBe('local');
    expect(merged[0].syncState).toBe(SYNC_STATES.PENDING);
  });
});
