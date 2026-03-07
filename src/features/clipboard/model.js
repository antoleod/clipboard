import { detectContentType } from './contentIntelligence';

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultDetails() {
  return {
    title: '',
    description: '',
    email: '',
    phone: '',
    tags: [],
    source: '',
    category: '',
    favorite: false
  };
}

export function normalizeItem(item = {}, defaults = {}) {
  const createdAt = item.createdAt || new Date().toISOString();
  const content = item.content ?? '';
  const details = { ...defaultDetails(), ...(item.details || {}) };
  const contentType = item.contentType || detectContentType(item);
  return {
    id: item.id || makeId(),
    kind: item.kind || 'text',
    content,
    preview: item.preview || String(content).slice(0, 120),
    createdAt,
    updatedAt: item.updatedAt || createdAt,
    source: item.source || 'manual',
    contentType,
    details,
    scope: item.scope || defaults.scope || 'local',
    visibility: item.visibility || defaults.visibility || 'personal',
    sharedWith: Array.isArray(item.sharedWith) ? item.sharedWith : [],
    ownerId: item.ownerId || defaults.ownerId || '',
    ownerEmail: item.ownerEmail || defaults.ownerEmail || '',
    ownerName: item.ownerName || defaults.ownerName || '',
    sharedBy: item.sharedBy || defaults.sharedBy || '',
    collectionId: item.collectionId || '',
    pinned: Boolean(item.pinned || details.favorite),
    copyCount: Number(item.copyCount || 0),
    sensitive: item.sensitive ?? false,
    pendingSync: Boolean(item.pendingSync),
    lastSyncError: item.lastSyncError || ''
  };
}

export function createItemFromText(value, source = 'manual') {
  return normalizeItem({
    kind: 'text',
    content: value,
    preview: String(value).slice(0, 120),
    source
  });
}

export function mergeById(localItems = [], cloudItems = []) {
  const map = new Map();
  for (const item of localItems) map.set(item.id, item);
  for (const item of cloudItems) map.set(item.id, item);
  return [...map.values()].sort(
    (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
  );
}
