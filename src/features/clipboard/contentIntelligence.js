const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9()\-\s]{6,}$/;
const MARKDOWN_PATTERNS = [
  /^#{1,6}\s/m,
  /(^|\n)(?:- |\* |\+ )/m,
  /(^|\n)\d+\.\s/m,
  /```[\s\S]*```/m,
  /\[[^\]]+\]\([^)]+\)/m,
  /(^|\n)>\s/m
];
const CODE_PATTERNS = [
  /\b(function|const|let|var|class|interface|type|enum|return|async|await)\b/m,
  /=>/m,
  /[{};]{2,}/m,
  /<\/?[a-z][^>]*>/i,
  /\b(import|export)\b/m,
  /\b(public|private|protected)\b/m
];
const HTML_RE = /<([a-z][^\s/>]*)(?:\s[^>]*)?>[\s\S]*<\/\1>|<([a-z][^\s/>]*)(?:\s[^>]*)?\/>/i;
const RICH_HINT_RE = /<[^>]+>|\*\*[^*]+\*\*|__[^_]+__|\[[^\]]+\]\([^)]+\)/;

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizedText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function looksLikeUrl(value) {
  if (!URL_RE.test(value)) return false;
  try {
    const normalized = value.startsWith('http') ? value : `https://${value}`;
    const parsed = new URL(normalized);
    return Boolean(parsed.hostname && parsed.hostname.includes('.'));
  } catch {
    return false;
  }
}

function markdownScore(text) {
  return MARKDOWN_PATTERNS.reduce((score, pattern) => (pattern.test(text) ? score + 1 : score), 0);
}

function codeScore(text) {
  let score = CODE_PATTERNS.reduce((count, pattern) => (pattern.test(text) ? count + 1 : count), 0);

  const lines = text.split('\n').filter(Boolean);
  const indentedLines = lines.filter((line) => /^\s{2,}/.test(line)).length;
  if (lines.length >= 3 && indentedLines >= 2) score += 1;

  const punctuationDensity = (text.match(/[{}()[\];=<>]/g) || []).length / Math.max(1, text.length);
  if (punctuationDensity > 0.045) score += 1;

  return score;
}

function htmlScore(text) {
  let score = 0;
  if (HTML_RE.test(text)) score += 2;
  if (/<(div|span|p|a|img|section|article|script|style|table|ul|ol|li)\b/i.test(text)) score += 1;
  if (/&[a-z]+;/.test(text)) score += 1;
  return score;
}

function detectPrimaryType(item, text) {
  if (item.kind === 'image') return 'image';
  if (!text) return 'text';
  if (EMAIL_RE.test(text)) return 'email';
  if (looksLikeUrl(text)) return 'url';
  if (PHONE_RE.test(text)) return 'phone';

  const parsedJson = safeJsonParse(text);
  const isStructuredJson =
    parsedJson !== null &&
    (Array.isArray(parsedJson) || (typeof parsedJson === 'object' && parsedJson !== null));

  const mdScore = markdownScore(text);
  const cdScore = codeScore(text);
  const hScore = htmlScore(text);

  if (isStructuredJson) return 'json';
  if (hScore >= 2 && mdScore <= 2) return 'html';
  if (mdScore >= 2 && mdScore >= cdScore) return 'markdown';
  if (cdScore >= 3) return 'code';
  if (hScore >= 1 && cdScore >= 2) return 'rich';

  return 'text';
}

export function classifyClipboardContent(item = {}) {
  const text = normalizedText(item.kind === 'image' ? '' : item.content);
  const primaryType = detectPrimaryType(item, text);
  const secondaryTypes = [];

  if (primaryType !== 'json' && safeJsonParse(text) !== null && text.startsWith('{')) {
    secondaryTypes.push('json');
  }

  if (primaryType !== 'code' && codeScore(text) >= 3) {
    secondaryTypes.push('code');
  }

  if (primaryType !== 'markdown' && markdownScore(text) >= 2) {
    secondaryTypes.push('markdown');
  }

  if (primaryType !== 'html' && htmlScore(text) >= 2) {
    secondaryTypes.push('html');
  }

  if (primaryType !== 'rich' && RICH_HINT_RE.test(text) && secondaryTypes.length >= 2) {
    secondaryTypes.push('rich');
  }

  return {
    primaryType,
    secondaryTypes: [...new Set(secondaryTypes)]
  };
}

export function detectContentType(item) {
  return classifyClipboardContent(item).primaryType;
}

export function computeSensitive(item) {
  const type = item.contentType || detectContentType(item);
  if (type === 'email' || type === 'phone') return true;
  const text = String(item.content ?? '');
  return /password|token|secret|apikey|private key|pin|otp|ssn|iban/i.test(text);
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
  if (type === 'code' || type === 'json' || type === 'html') {
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
