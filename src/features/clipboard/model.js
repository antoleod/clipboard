import { classifyClipboardContent, detectContentType } from './contentIntelligence';
import { normalizeClipboardText, quickHashText } from '../../utils/hash';

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
  const kind = item.kind || 'text';
  const normalizedText = kind === 'text' ? normalizeClipboardText(content) : '';
  const details = { ...defaultDetails(), ...(item.details || {}) };
  const classification = classifyClipboardContent({
    ...item,
    kind,
    content: kind === 'text' ? normalizedText : content
  });
  const rawContentType = item.contentType || classification.primaryType || detectContentType(item);
  const contentType = rawContentType === 'plain' ? 'text' : rawContentType;
  const typeTags = Array.isArray(item.typeTags) && item.typeTags.length
    ? [...new Set(item.typeTags)]
    : classification.secondaryTypes;
  const usageCount = Number(item.usageCount ?? item.copyCount ?? 0);
  const contentHash =
    item.contentHash ||
    (kind === 'text'
      ? quickHashText(normalizedText)
      : quickHashText(`${kind}:${String(item.preview || content).slice(0, 120)}`));
  return {
    id: item.id || makeId(),
    kind,
    content: kind === 'text' ? normalizedText : content,
    preview: item.preview || String(kind === 'text' ? normalizedText : content).slice(0, 120),
    createdAt,
    updatedAt: item.updatedAt || createdAt,
    source: item.source || 'manual',
    contentType,
    details,
    typeTags,
    scope: item.scope || defaults.scope || 'local',
    visibility: item.visibility || defaults.visibility || 'personal',
    sharedWith: Array.isArray(item.sharedWith) ? item.sharedWith : [],
    ownerId: item.ownerId || defaults.ownerId || '',
    ownerEmail: item.ownerEmail || defaults.ownerEmail || '',
    ownerName: item.ownerName || defaults.ownerName || '',
    sharedBy: item.sharedBy || defaults.sharedBy || '',
    collectionId: item.collectionId || '',
    pinned: Boolean(item.pinned || details.favorite),
    copyCount: usageCount,
    usageCount,
    contentHash,
    lastCopiedAt: item.lastCopiedAt || item.updatedAt || createdAt,
    archived: Boolean(item.archived),
    sensitive: item.sensitive ?? false,
    pendingSync: Boolean(item.pendingSync),
    lastSyncError: item.lastSyncError || '',
    syncState: item.syncState || ''
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

  function keyFor(item) {
    return item.contentHash ? `hash:${item.contentHash}` : `id:${item.id}`;
  }

  function takeMostRecent(current, incoming) {
    const currentTs = new Date(current.lastCopiedAt || current.updatedAt || current.createdAt).getTime();
    const incomingTs = new Date(incoming.lastCopiedAt || incoming.updatedAt || incoming.createdAt).getTime();
    const latest = incomingTs >= currentTs ? incoming : current;
    const previous = incomingTs >= currentTs ? current : incoming;
    return {
      ...previous,
      ...latest,
      pinned: Boolean(current.pinned || incoming.pinned),
      archived: Boolean(latest.archived),
      pendingSync: latest.scope === 'local' ? Boolean(latest.pendingSync || previous.pendingSync) : false,
      usageCount: Math.max(Number(current.usageCount || current.copyCount || 0), Number(incoming.usageCount || incoming.copyCount || 0)),
      copyCount: Math.max(
        Number(current.copyCount || current.usageCount || 0),
        Number(incoming.copyCount || incoming.usageCount || 0)
      )
    };
  }

  for (const item of [...cloudItems, ...localItems]) {
    const key = keyFor(item);
    const existing = map.get(key);
    map.set(key, existing ? takeMostRecent(existing, item) : item);
  }

  return [...map.values()].sort(
    (a, b) =>
      new Date(b.lastCopiedAt || b.updatedAt || b.createdAt).getTime() -
      new Date(a.lastCopiedAt || a.updatedAt || a.createdAt).getTime()
  );
}
