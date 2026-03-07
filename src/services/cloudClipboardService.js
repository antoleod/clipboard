import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { db } from './firebase';

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
  return {
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

export async function createCloudItem(user, item, overrides = {}) {
  const payload = toCloudPayload(item, user, overrides);
  const ref = await addDoc(collection(db, ITEMS_COLLECTION), payload);
  return ref.id;
}

export async function updateCloudItem(user, itemId, updates = {}) {
  const ref = doc(db, ITEMS_COLLECTION, itemId);
  const patch = {
    ...updates,
    ...(updates.sharedWith ? { sharedWith: normalizeEmails(updates.sharedWith) } : {}),
    updatedAt: serverTimestamp()
  };
  await updateDoc(ref, patch);
}

export async function deleteCloudItem(itemId) {
  await deleteDoc(doc(db, ITEMS_COLLECTION, itemId));
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

export function watchAccessibleClipboardItems(user, onItems, onError) {
  if (!user?.uid) {
    onItems([]);
    return () => {};
  }

  const ownQ = query(collection(db, ITEMS_COLLECTION), where('ownerId', '==', user.uid));
  const sharedEmail = (user.email || '').toLowerCase();
  const sharedQ = query(collection(db, ITEMS_COLLECTION), where('sharedWith', 'array-contains', sharedEmail));

  let ownItems = [];
  let sharedItems = [];

  function emit() {
    const merged = new Map();
    for (const item of ownItems) merged.set(item.id, item);
    for (const item of sharedItems) {
      merged.set(item.id, { ...item, scope: item.ownerId === user.uid ? 'synced' : 'shared' });
    }
    onItems(
      [...merged.values()].sort(
        (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
      )
    );
  }

  const unsubOwn = onSnapshot(
    ownQ,
    (snap) => {
      ownItems = snap.docs.map((d) => fromDoc(d, 'synced'));
      emit();
    },
    (error) => onError?.(error)
  );

  const unsubShared = onSnapshot(
    sharedQ,
    (snap) => {
      sharedItems = snap.docs.map((d) => fromDoc(d, 'shared'));
      emit();
    },
    (error) => onError?.(error)
  );

  return () => {
    unsubOwn();
    unsubShared();
  };
}
