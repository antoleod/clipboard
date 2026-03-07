export function cleanText(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .trim();
}

export function formatForCopy(item) {
  if (!item) return '';
  if (item.contentType === 'json') {
    try {
      return JSON.stringify(JSON.parse(item.content), null, 2);
    } catch {
      return String(item.content ?? '');
    }
  }
  return String(item.content ?? '');
}

