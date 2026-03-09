import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  where
} from 'firebase/firestore';
import { db } from './firebase';
import { buildStableItemId, formatSyncError } from './clipboardSyncService';

const ITEMS_COLLECTION = 'clipboardItems';
const COLLECTIONS_COLLECTION = 'sharedCollections';

function normalizeEmails(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function fromDoc(snapshot, scopeFallback = 'synced') {
  const data = snapshot.data();
  const usageCount = Number(data.usageCount ?? data.copyCount ?? 0);
  return {
    id: snapshot.id,
    ...data,
    usageCount,
    copyCount: usageCount,
    createdAt:
      typeof data.createdAt === 'string' ? data.createdAt : data.createdAt?.toDate?.().toISOString?.() || new Date().toISOString(),
    updatedAt:
      typeof data.updatedAt === 'string' ? data.updatedAt : data.updatedAt?.toDate?.().toISOString?.() || new Date().toISOString(),
    lastCopiedAt:
      typeof data.lastCopiedAt === 'string' ? data.lastCopiedAt : data.lastCopiedAt?.toDate?.().toISOString?.() || '',
    scope: data.scope || scopeFallback
  };
}

function toCloudPayload(item, user, overrides = {}) {
  const usageCount = Number(item.usageCount ?? item.copyCount ?? 0);
  const itemId = item.id || buildStableItemId(user.uid, item.contentHash);
  return {
    id: itemId,
    content: item.content ?? '',
    preview: item.preview ?? '',
    kind: item.kind ?? 'text',
    contentType: item.contentType ?? 'plain',
    typeTags: Array.isArray(item.typeTags) ? item.typeTags : [],
    contentHash: item.contentHash || '',
    details: item.details ?? {},
    source: item.source ?? 'manual',
    ownerId: user.uid,
    ownerEmail: user.email ?? '',
    ownerName: user.displayName ?? '',
    sharedBy: overrides.sharedBy || user.email || user.uid,
    sharedWith: normalizeEmails(overrides.sharedWith || item.sharedWith || []),
    visibility: overrides.visibility || item.visibility || 'personal',
    collectionId: overrides.collectionId || item.collectionId || '',
    scope: overrides.scope || item.scope || 'synced',
    pinned: Boolean(item.pinned),
    archived: Boolean(item.archived),
    usageCount,
    copyCount: usageCount,
    lastCopiedAt: item.lastCopiedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdAt: item.createdAt ? item.createdAt : serverTimestamp()
  };
}

export function getCloudItemId(user, item) {
  return item.id || buildStableItemId(user.uid, item.contentHash || '');
}

export function describeCloudError(error) {
  return formatSyncError(error);
}

export async function createCloudItem(user, item, overrides = {}) {
  const itemId = getCloudItemId(user, item);
  const payload = toCloudPayload(item, user, overrides);
  const ref = doc(db, ITEMS_COLLECTION, itemId);
  await setDoc(ref, payload, { merge: true });
  return ref.id;
}

export async function updateCloudItem(user, itemId, updates = {}) {
  const ref = doc(db, ITEMS_COLLECTION, itemId);
  const patch = {
    ...updates,
    ...(updates.sharedWith ? { sharedWith: normalizeEmails(updates.sharedWith) } : {}),
    ownerId: user.uid,
    ownerEmail: user.email ?? '',
    ownerName: user.displayName ?? '',
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, patch, { merge: true });
}

export async function deleteCloudItem(itemId) {
  await deleteDoc(doc(db, ITEMS_COLLECTION, itemId));
}

export async function dedupeCloudItemsByContentHash(user, items = []) {
  if (!user?.uid) return { removed: 0 };
  const groups = new Map();

  for (const item of items) {
    if (!item?.contentHash) continue;
    const key = String(item.contentHash);
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }

  const batch = writeBatch(db);
  let removed = 0;
  let operations = 0;

  for (const [hash, group] of groups.entries()) {
    if (group.length <= 1) continue;
    const stableId = buildStableItemId(user.uid, hash);
    const stableItem = group.find((candidate) => candidate.id === stableId);
    const keep =
      stableItem ||
      group.reduce((best, candidate) => {
        const bestTs = new Date(best.updatedAt || best.createdAt || 0).getTime();
        const candidateTs = new Date(candidate.updatedAt || candidate.createdAt || 0).getTime();
        return candidateTs >= bestTs ? candidate : best;
      }, group[0]);

    for (const candidate of group) {
      if (!candidate?.id || candidate.id === keep.id) continue;
      batch.delete(doc(db, ITEMS_COLLECTION, candidate.id));
      removed += 1;
      operations += 1;
      if (operations >= 450) break;
    }
    if (operations >= 450) break;
  }

  if (operations > 0) {
    await batch.commit();
  }

  return { removed };
}

export async function createSharedCollection(user, name, members = []) {
  const ref = doc(collection(db, COLLECTIONS_COLLECTION));
  const payload = {
    id: ref.id,
    name: String(name || '').trim() || 'Shared collection',
    ownerId: user.uid,
    ownerEmail: user.email ?? '',
    members: normalizeEmails([user.email, ...members]),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, payload);
  return ref.id;
}

export function buildShareLink(itemId) {
  const url = new URL(window.location.href);
  url.searchParams.set('shared', itemId);
  return url.toString();
}

export function watchAccessibleClipboardItems(user, onItems, onError, onStateChange) {
  if (!user?.uid) {
    onItems([]);
    onStateChange?.({ listenerState: 'idle', backendState: 'signed-out' });
    return () => {};
  }

  const ownQ = query(collection(db, ITEMS_COLLECTION), where('ownerId', '==', user.uid));

  const unsubOwn = onSnapshot(
    ownQ,
    (snap) => {
      onStateChange?.({ listenerState: 'active', backendState: 'connected' });
      const items = snap.docs
        .map((d) => fromDoc(d, 'synced'))
        .sort(
          (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
        );
      onItems(items);
    },
    (error) => {
      onStateChange?.({ listenerState: 'error', backendState: 'failed' });
      onError?.(error);
    }
  );

  return () => {
    unsubOwn();
  };
}
