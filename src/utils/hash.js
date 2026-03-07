function normalizeLineEndings(value = '') {
  return String(value).replace(/\r\n/g, '\n').trim();
}

function fallbackHash(value = '') {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `f${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function normalizeClipboardText(value = '') {
  return normalizeLineEndings(value);
}

export function quickHashText(value = '') {
  const normalized = normalizeLineEndings(value);
  return normalized ? fallbackHash(normalized) : '';
}

export async function sha1Text(value = '') {
  const normalized = normalizeLineEndings(value);
  if (!normalized) return '';

  try {
    if (globalThis.crypto?.subtle && globalThis.TextEncoder) {
      const bytes = new TextEncoder().encode(normalized);
      const digest = await globalThis.crypto.subtle.digest('SHA-1', bytes);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // Fallback below for older environments.
  }

  return quickHashText(normalized);
}
