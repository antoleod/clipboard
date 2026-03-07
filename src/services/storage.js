const KEY = 'clipboard-vault-items';
const SETTINGS_KEY = 'clipboard-vault-settings';

export function loadItems() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveItems(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw
      ? JSON.parse(raw)
      : {
          autoCapture: false,
          quotaBytes: 20 * 1024 * 1024,
          pollingMs: 3000
        };
  } catch {
    return {
      autoCapture: false,
      quotaBytes: 20 * 1024 * 1024,
      pollingMs: 3000
    };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
