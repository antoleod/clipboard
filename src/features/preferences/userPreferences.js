import { DEFAULT_THEME_ID } from '../theme/themeSystem';

export const USER_PREFERENCES_VERSION = 1;

export const DEFAULT_USER_PREFERENCES = {
  schemaVersion: USER_PREFERENCES_VERSION,
  themeId: DEFAULT_THEME_ID,
  themeMode: 'dark',
  fontScale: 1,
  compactMode: true,
  blurSensitiveContent: false,
  hidePreviews: false,
  autoCapture: true,
  captureIntervalSec: 3,
  captureTarget: 'synced',
  autoSyncPending: true,
  keepSignedIn: true,
  activeFilters: ['all'],
  sortMode: 'newest',
  customThemeOverrides: {
    accentPrimary: '',
    panelIntensity: 0,
    cardContrast: 0,
    borderStrength: 1,
    blurAmount: 14
  }
};

function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function asBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function normalizeFilterList(value) {
  if (!Array.isArray(value) || !value.length) return ['all'];
  return [...new Set(value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeOverrides(value = {}) {
  const current = typeof value === 'object' && value ? value : {};
  return {
    accentPrimary: typeof current.accentPrimary === 'string' ? current.accentPrimary : '',
    panelIntensity: clamp(current.panelIntensity, -24, 24, 0),
    cardContrast: clamp(current.cardContrast, -24, 24, 0),
    borderStrength: clamp(current.borderStrength, 0.6, 1.8, 1),
    blurAmount: clamp(current.blurAmount, 0, 24, 14)
  };
}

function migrateLegacy(raw = {}) {
  const legacy = { ...raw };

  if (legacy.theme && !legacy.themeId) legacy.themeId = legacy.theme;
  if (legacy.pollingMs && !legacy.captureIntervalSec) {
    legacy.captureIntervalSec = Math.round(Number(legacy.pollingMs) / 1000);
  }
  if (typeof legacy.autoSyncLocal === 'boolean' && typeof legacy.autoSyncPending !== 'boolean') {
    legacy.autoSyncPending = legacy.autoSyncLocal;
  }
  if (typeof legacy.blurSensitive === 'boolean' && typeof legacy.blurSensitiveContent !== 'boolean') {
    legacy.blurSensitiveContent = legacy.blurSensitive;
  }

  return legacy;
}

export function normalizeUserPreferences(raw = {}) {
  const migrated = migrateLegacy(raw);
  const merged = {
    ...DEFAULT_USER_PREFERENCES,
    ...migrated,
    customThemeOverrides: {
      ...DEFAULT_USER_PREFERENCES.customThemeOverrides,
      ...(migrated.customThemeOverrides || {})
    }
  };

  return {
    schemaVersion: USER_PREFERENCES_VERSION,
    themeId: String(merged.themeId || DEFAULT_USER_PREFERENCES.themeId),
    themeMode: merged.themeMode === 'light' ? 'light' : 'dark',
    fontScale: clamp(merged.fontScale, 0.9, 1.2, 1),
    compactMode: asBoolean(merged.compactMode, true),
    blurSensitiveContent: asBoolean(merged.blurSensitiveContent, false),
    hidePreviews: asBoolean(merged.hidePreviews, false),
    autoCapture: asBoolean(merged.autoCapture, true),
    captureIntervalSec: clamp(merged.captureIntervalSec, 2, 10, 3),
    captureTarget: merged.captureTarget === 'local' ? 'local' : 'synced',
    autoSyncPending: asBoolean(merged.autoSyncPending, true),
    keepSignedIn: asBoolean(merged.keepSignedIn, true),
    activeFilters: normalizeFilterList(merged.activeFilters),
    sortMode: merged.sortMode === 'oldest' ? 'oldest' : 'newest',
    customThemeOverrides: normalizeOverrides(merged.customThemeOverrides)
  };
}

export function mergeUserPreferences(base = {}, incoming = {}) {
  const normalizedBase = normalizeUserPreferences(base);
  const normalizedIncoming = normalizeUserPreferences(incoming);

  return normalizeUserPreferences({
    ...normalizedBase,
    ...normalizedIncoming,
    customThemeOverrides: {
      ...normalizedBase.customThemeOverrides,
      ...normalizedIncoming.customThemeOverrides
    }
  });
}
