function byUpdatedDesc(a, b) {
  return new Date(b.lastCopiedAt || b.updatedAt || b.createdAt).getTime() - new Date(a.lastCopiedAt || a.updatedAt || a.createdAt).getTime();
}

function byUsageDesc(a, b) {
  return Number(b.usageCount || b.copyCount || 0) - Number(a.usageCount || a.copyCount || 0);
}

export function buildClipboardSections(items = [], options = {}) {
  const recentLimit = Math.max(10, Number(options.recentLimit) || 24);
  const frequentLimit = Math.max(6, Number(options.frequentLimit) || 12);
  const archiveCollapsed = Boolean(options.archiveCollapsed);

  const active = items.filter((item) => !item.archived);
  const archived = items.filter((item) => item.archived).sort(byUpdatedDesc);
  const pinned = active.filter((item) => item.pinned).sort(byUpdatedDesc);

  const recentPool = active.filter((item) => !item.pinned).sort(byUpdatedDesc);
  const recent = recentPool.slice(0, recentLimit);

  const excluded = new Set([...pinned, ...recent].map((item) => item.id));
  const frequent = active
    .filter((item) => !excluded.has(item.id))
    .sort((a, b) => byUsageDesc(a, b) || byUpdatedDesc(a, b))
    .slice(0, frequentLimit);

  return {
    RECENT: recent,
    'MOST USED': frequent,
    PINNED: pinned,
    ARCHIVE: archiveCollapsed ? archived.slice(0, 10) : archived
  };
}
