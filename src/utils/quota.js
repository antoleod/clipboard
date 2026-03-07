export const FREE_BYTES = 20 * 1024 * 1024;

export function roughBytes(item) {
  if (!item) return 0;
  if (item.kind === 'image') {
    return item.sizeBytes ?? 0;
  }
  return new Blob([item.content ?? '']).size;
}

export function usageBytes(items = []) {
  return items.reduce((sum, item) => sum + roughBytes(item), 0);
}

export function formatBytes(bytes = 0) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function canStore(items, candidate, quota = FREE_BYTES) {
  return usageBytes([...items, candidate]) <= quota;
}
