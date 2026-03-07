function toDayKey(dateIso) {
  const d = new Date(dateIso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(
    2,
    '0'
  )}`;
}

export function buildDashboardStats(items) {
  const categories = {};
  const copies = {};
  const daily = {};
  let local = 0;
  let synced = 0;
  let shared = 0;
  let pinned = 0;

  for (const item of items) {
    if (item.scope === 'local') local += 1;
    if (item.scope === 'synced') synced += 1;
    if (item.scope === 'shared') shared += 1;
    if (item.pinned || item.details?.favorite) pinned += 1;

    const category = item.details?.category || item.contentType || item.kind || 'other';
    categories[category] = (categories[category] || 0) + 1;

    if (item.content) {
      const key = String(item.content).slice(0, 70);
      copies[key] = (copies[key] || 0) + (item.copyCount || 0);
    }

    const day = toDayKey(item.createdAt);
    daily[day] = (daily[day] || 0) + 1;
  }

  const mostCopied = Object.entries(copies)
    .map(([content, count]) => ({ content, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    total: items.length,
    local,
    synced,
    shared,
    pinned,
    mostCopied,
    categories,
    daily
  };
}

