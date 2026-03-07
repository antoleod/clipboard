const URL_RE = /^(https?:\/\/|www\.)[^\s/$.?#].[^\s]*$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9()\-\s]{6,}$/;
const MARKDOWN_RE = /(^#{1,6}\s)|(\[[^\]]+\]\([^)]+\))|(```[\s\S]*```)|(^>\s)|(^-\s)|(^\d+\.\s)/m;
const CODE_RE =
  /(function\s+\w+|const\s+\w+\s*=|class\s+\w+|import\s+.+from|export\s+default|<\/?[a-z][\s\S]*>|=>|;\s*$)/m;

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function detectContentType(item) {
  if (item.kind === 'image') return 'image';
  const text = String(item.content ?? '').trim();
  if (!text) return 'plain';
  if (URL_RE.test(text)) return 'url';
  if (EMAIL_RE.test(text)) return 'email';
  if (PHONE_RE.test(text)) return 'phone';
  if (safeJsonParse(text) && (text.startsWith('{') || text.startsWith('['))) return 'json';
  if (MARKDOWN_RE.test(text)) return 'markdown';
  if (CODE_RE.test(text)) return 'code';
  return 'plain';
}

export function computeSensitive(item) {
  const type = item.contentType || detectContentType(item);
  if (type === 'email' || type === 'phone') return true;
  const text = String(item.content ?? '');
  return /password|token|secret|apikey|pin/i.test(text);
}

export function getDomain(value) {
  try {
    const normalized = value.startsWith('http') ? value : `https://${value}`;
    return new URL(normalized).hostname;
  } catch {
    return '';
  }
}

export function getItemActions(item) {
  const type = item.contentType || detectContentType(item);
  const content = String(item.content ?? '');
  const actions = [];

  if (type === 'url') {
    actions.push(
      { id: 'open-link', label: 'Open link' },
      { id: 'copy-domain', label: 'Copy domain' },
      { id: 'preview-link', label: 'Preview site' }
    );
  }
  if (type === 'email') {
    actions.push(
      { id: 'send-email', label: 'Send email' },
      { id: 'copy-email', label: 'Copy address' },
      { id: 'save-detail-email', label: 'Save as detail' }
    );
  }
  if (type === 'phone') {
    actions.push(
      { id: 'copy-phone', label: 'Copy number' },
      { id: 'save-detail-phone', label: 'Save contact detail' }
    );
  }
  if (type === 'code' || type === 'json') {
    actions.push(
      { id: 'copy-formatted', label: 'Copy formatted' },
      { id: 'highlight', label: 'Highlight syntax' },
      { id: 'compare', label: 'Compare entry' }
    );
  }
  if (type === 'markdown') {
    actions.push({ id: 'copy-markdown', label: 'Copy markdown' });
  }
  if (!actions.length && content) {
    actions.push({ id: 'copy', label: 'Copy text' });
  }
  return actions;
}

