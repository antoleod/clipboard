const VARIABLE_RE = /\{([a-zA-Z0-9_]+)\}/g;

export function extractSnippetVariables(template = '') {
  const vars = new Set();
  for (const match of template.matchAll(VARIABLE_RE)) {
    vars.add(match[1]);
  }
  return [...vars];
}

export function renderSnippet(template = '', values = {}) {
  return template.replace(VARIABLE_RE, (_, name) => String(values[name] ?? ''));
}

