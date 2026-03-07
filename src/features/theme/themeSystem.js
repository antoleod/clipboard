const FALLBACK_THEME_ID = 'midnight-vault';
const THEME_CACHE_KEY = 'clipboard-vault-last-theme';

function clamp(value, min, max) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeHex(value, fallback = '#4aa3ff') {
  const candidate = String(value || '').trim();
  const short = /^#([\da-f]{3}|[\da-f]{4})$/i;
  const long = /^#([\da-f]{6}|[\da-f]{8})$/i;
  if (!short.test(candidate) && !long.test(candidate)) return fallback;

  if (candidate.length === 4 || candidate.length === 5) {
    const chars = candidate.slice(1).split('');
    const expanded = chars.map((char) => `${char}${char}`).join('');
    return `#${expanded}`;
  }

  return candidate.toLowerCase();
}

function hexToRgb(value) {
  const normalized = normalizeHex(value);
  const payload = normalized.slice(1);
  const hasAlpha = payload.length === 8;
  const r = Number.parseInt(payload.slice(0, 2), 16);
  const g = Number.parseInt(payload.slice(2, 4), 16);
  const b = Number.parseInt(payload.slice(4, 6), 16);
  const a = hasAlpha ? Number.parseInt(payload.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function toHexChannel(value) {
  const numeric = clamp(Math.round(value), 0, 255);
  return numeric.toString(16).padStart(2, '0');
}

function shiftColor(value, amount = 0) {
  const { r, g, b, a } = hexToRgb(value);
  const next = {
    r: r + amount,
    g: g + amount,
    b: b + amount,
    a
  };
  return `#${toHexChannel(next.r)}${toHexChannel(next.g)}${toHexChannel(next.b)}${toHexChannel(a * 255)}`;
}

function mixColors(colorA, colorB, weight = 0.5) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const ratio = clamp(weight, 0, 1);
  const inv = 1 - ratio;
  const r = a.r * inv + b.r * ratio;
  const g = a.g * inv + b.g * ratio;
  const bValue = a.b * inv + b.b * ratio;
  const alpha = a.a * inv + b.a * ratio;
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(bValue)}${toHexChannel(alpha * 255)}`;
}

function rgba(value, alpha = 1) {
  const { r, g, b } = hexToRgb(value);
  const safeAlpha = clamp(alpha, 0, 1);
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

const BASE_THEMES = [
  {
    id: 'midnight-vault',
    label: 'Midnight Vault',
    mode: 'dark',
    colors: {
      bgApp: '#06080f',
      bgShell: '#0b111d',
      bgPanel: '#111a2a',
      bgPanelElevated: '#162336',
      bgCard: '#1a2a3f',
      bgCardHover: '#22354d',
      bgInput: '#111d2d',
      bgButton: '#1a2d44',
      bgButtonSecondary: '#122033',
      borderBase: '#83a2c8',
      textPrimary: '#e8f1ff',
      textSecondary: '#c4d6ee',
      textMuted: '#8ea4c0',
      textInverse: '#02070e',
      accentPrimary: '#4ca6ff',
      accentSecondary: '#8ec8ff',
      success: '#33d49f',
      warning: '#f4c45c',
      danger: '#ff6e8e',
      tagBg: '#13253b',
      tagBorder: '#355273',
      tagText: '#dce9ff'
    }
  },
  {
    id: 'ep-dark-blue',
    label: 'EP Dark Blue',
    mode: 'dark',
    colors: {
      bgApp: '#050814',
      bgShell: '#0b1330',
      bgPanel: '#131f42',
      bgPanelElevated: '#182a56',
      bgCard: '#1f315f',
      bgCardHover: '#28407a',
      bgInput: '#111f41',
      bgButton: '#26457a',
      bgButtonSecondary: '#152a50',
      borderBase: '#7a9bd4',
      textPrimary: '#e9f0ff',
      textSecondary: '#c8d6f2',
      textMuted: '#97abcc',
      textInverse: '#030915',
      accentPrimary: '#6aa8ff',
      accentSecondary: '#9ec6ff',
      success: '#41d39d',
      warning: '#f4be5e',
      danger: '#ff7998',
      tagBg: '#1a315e',
      tagBorder: '#40649b',
      tagText: '#deebff'
    }
  },
  {
    id: 'matrix-green',
    label: 'Matrix Green',
    mode: 'dark',
    colors: {
      bgApp: '#020604',
      bgShell: '#07140d',
      bgPanel: '#0d1e14',
      bgPanelElevated: '#132a1d',
      bgCard: '#183524',
      bgCardHover: '#21462f',
      bgInput: '#0f2318',
      bgButton: '#1d4a31',
      bgButtonSecondary: '#122c1e',
      borderBase: '#6fa78a',
      textPrimary: '#dfffea',
      textSecondary: '#bee6ce',
      textMuted: '#88b198',
      textInverse: '#021008',
      accentPrimary: '#39e47c',
      accentSecondary: '#88f1ae',
      success: '#3deb8b',
      warning: '#f3d95b',
      danger: '#ff7a91',
      tagBg: '#143022',
      tagBorder: '#33634b',
      tagText: '#dbffe9'
    }
  },
  {
    id: 'slate-graphite',
    label: 'Slate Graphite',
    mode: 'dark',
    colors: {
      bgApp: '#0f1116',
      bgShell: '#171c25',
      bgPanel: '#1e2531',
      bgPanelElevated: '#252f3d',
      bgCard: '#2a3748',
      bgCardHover: '#344559',
      bgInput: '#1f2b3a',
      bgButton: '#375170',
      bgButtonSecondary: '#263344',
      borderBase: '#8da0ba',
      textPrimary: '#eef3fb',
      textSecondary: '#cdd8e8',
      textMuted: '#9eabc1',
      textInverse: '#05080e',
      accentPrimary: '#79aefc',
      accentSecondary: '#afceff',
      success: '#42d2a0',
      warning: '#f2bf61',
      danger: '#ff7f9a',
      tagBg: '#2a3a4d',
      tagBorder: '#4f6680',
      tagText: '#e4ecfb'
    }
  },
  {
    id: 'arctic-dark',
    label: 'Arctic Dark',
    mode: 'dark',
    colors: {
      bgApp: '#0b151f',
      bgShell: '#122231',
      bgPanel: '#183046',
      bgPanelElevated: '#1f3a54',
      bgCard: '#244563',
      bgCardHover: '#2f5678',
      bgInput: '#17334c',
      bgButton: '#2f638c',
      bgButtonSecondary: '#1e3f5d',
      borderBase: '#88aac7',
      textPrimary: '#eef6ff',
      textSecondary: '#c6d9eb',
      textMuted: '#97aec2',
      textInverse: '#040a10',
      accentPrimary: '#63bfff',
      accentSecondary: '#9edcff',
      success: '#47d3b2',
      warning: '#f0c36a',
      danger: '#ff86a2',
      tagBg: '#214865',
      tagBorder: '#4f7896',
      tagText: '#e3f0ff'
    }
  },
  {
    id: 'samsung-phantom-graphite',
    label: 'Samsung Phantom Graphite',
    mode: 'dark',
    colors: {
      bgApp: '#0b0d11',
      bgShell: '#14181f',
      bgPanel: '#1a2029',
      bgPanelElevated: '#242c37',
      bgCard: '#2b3541',
      bgCardHover: '#364352',
      bgInput: '#1f2733',
      bgButton: '#3c5068',
      bgButtonSecondary: '#273340',
      borderBase: '#9aa7b8',
      textPrimary: '#f1f4f8',
      textSecondary: '#d2dae4',
      textMuted: '#a3aebd',
      textInverse: '#020304',
      accentPrimary: '#8da4bf',
      accentSecondary: '#c0d0e2',
      success: '#4fd0a5',
      warning: '#f1be63',
      danger: '#ff809a',
      tagBg: '#2c3641',
      tagBorder: '#5a6878',
      tagText: '#eaf0f6'
    }
  },
  {
    id: 'samsung-navy-titanium',
    label: 'Samsung Navy Titanium',
    mode: 'dark',
    colors: {
      bgApp: '#070c17',
      bgShell: '#111a2d',
      bgPanel: '#17233a',
      bgPanelElevated: '#20304d',
      bgCard: '#263a5d',
      bgCardHover: '#2f4770',
      bgInput: '#182b45',
      bgButton: '#2f5f95',
      bgButtonSecondary: '#223754',
      borderBase: '#93a7cd',
      textPrimary: '#eaf0fb',
      textSecondary: '#c8d4ea',
      textMuted: '#95a7c5',
      textInverse: '#04070f',
      accentPrimary: '#79aefc',
      accentSecondary: '#a8c9ff',
      success: '#4ad0a5',
      warning: '#f0c366',
      danger: '#ff7fa2',
      tagBg: '#1f3555',
      tagBorder: '#4b6795',
      tagText: '#e3edff'
    }
  },
  {
    id: 'samsung-icy-blue',
    label: 'Samsung Icy Blue',
    mode: 'dark',
    colors: {
      bgApp: '#081019',
      bgShell: '#101e2d',
      bgPanel: '#17273a',
      bgPanelElevated: '#20344b',
      bgCard: '#28435e',
      bgCardHover: '#315371',
      bgInput: '#1a3046',
      bgButton: '#2d6792',
      bgButtonSecondary: '#21445f',
      borderBase: '#8cb2cf',
      textPrimary: '#eef7ff',
      textSecondary: '#c7dbeb',
      textMuted: '#95aec3',
      textInverse: '#04090f',
      accentPrimary: '#74c8ff',
      accentSecondary: '#addfff',
      success: '#4fd4b3',
      warning: '#efc86b',
      danger: '#ff88a4',
      tagBg: '#1f4564',
      tagBorder: '#4b7a9f',
      tagText: '#e4f2ff'
    }
  },
  {
    id: 'samsung-emerald-night',
    label: 'Samsung Emerald Night',
    mode: 'dark',
    colors: {
      bgApp: '#040c0b',
      bgShell: '#0c1b19',
      bgPanel: '#122824',
      bgPanelElevated: '#1a3530',
      bgCard: '#22443d',
      bgCardHover: '#2a554d',
      bgInput: '#17312d',
      bgButton: '#2d6c5e',
      bgButtonSecondary: '#1f3d37',
      borderBase: '#89b8a9',
      textPrimary: '#e8f8f2',
      textSecondary: '#c8e2d9',
      textMuted: '#93b5a9',
      textInverse: '#030806',
      accentPrimary: '#4ad3a6',
      accentSecondary: '#97edcc',
      success: '#41dc9f',
      warning: '#efc86d',
      danger: '#ff8098',
      tagBg: '#1a3d36',
      tagBorder: '#4f7b6f',
      tagText: '#def7ee'
    }
  },
  {
    id: 'samsung-violet-shadow',
    label: 'Samsung Violet Shadow',
    mode: 'dark',
    colors: {
      bgApp: '#0b0914',
      bgShell: '#17122a',
      bgPanel: '#231a3b',
      bgPanelElevated: '#2f234e',
      bgCard: '#3b2c5e',
      bgCardHover: '#4a3874',
      bgInput: '#2a2146',
      bgButton: '#644a97',
      bgButtonSecondary: '#3a2c5c',
      borderBase: '#a494c7',
      textPrimary: '#f2eeff',
      textSecondary: '#d6cdee',
      textMuted: '#a89dc5',
      textInverse: '#07030f',
      accentPrimary: '#b28cff',
      accentSecondary: '#d0b8ff',
      success: '#5dd4ad',
      warning: '#f1c66b',
      danger: '#ff84b5',
      tagBg: '#342855',
      tagBorder: '#665289',
      tagText: '#eee6ff'
    }
  }
];

const THEMES_BY_ID = Object.fromEntries(BASE_THEMES.map((theme) => [theme.id, theme]));

function resolveTheme(themeId) {
  return THEMES_BY_ID[themeId] || THEMES_BY_ID[FALLBACK_THEME_ID];
}

function normalizeOverrides(overrides = {}) {
  let accentPrimary = '';
  if (typeof overrides.accentPrimary === 'string' && overrides.accentPrimary.trim()) {
    accentPrimary = normalizeHex(overrides.accentPrimary);
  }

  return {
    accentPrimary,
    panelIntensity: clamp(overrides.panelIntensity ?? 0, -24, 24),
    cardContrast: clamp(overrides.cardContrast ?? 0, -24, 24),
    borderStrength: clamp(overrides.borderStrength ?? 1, 0.6, 1.8),
    blurAmount: clamp(overrides.blurAmount ?? 14, 0, 24)
  };
}

export function buildThemeTokens(themeId, themeMode = 'dark', overrides = {}) {
  const theme = resolveTheme(themeId);
  const settings = normalizeOverrides(overrides);
  const palette = theme.colors;

  const accentPrimary = settings.accentPrimary || palette.accentPrimary;
  const accentSecondary = mixColors(palette.accentSecondary, accentPrimary, 0.32);
  const panelAdjust = settings.panelIntensity * 1.6;
  const cardAdjust = settings.cardContrast * 1.4;

  return {
    '--bg-app': themeMode === 'dark' ? palette.bgApp : shiftColor(palette.bgApp, 110),
    '--bg-shell': shiftColor(palette.bgShell, panelAdjust * 0.2),
    '--bg-panel': shiftColor(palette.bgPanel, panelAdjust * 0.5),
    '--bg-panel-elevated': shiftColor(palette.bgPanelElevated, panelAdjust * 0.7),
    '--bg-card': shiftColor(palette.bgCard, cardAdjust * 0.5),
    '--bg-card-hover': shiftColor(palette.bgCardHover, cardAdjust * 0.7),
    '--bg-input': shiftColor(palette.bgInput, panelAdjust * 0.4),
    '--bg-button': shiftColor(palette.bgButton, panelAdjust * 0.35),
    '--bg-button-secondary': shiftColor(palette.bgButtonSecondary, panelAdjust * 0.3),
    '--border-default': rgba(palette.borderBase, clamp(0.22 * settings.borderStrength, 0.12, 0.45)),
    '--border-strong': rgba(palette.borderBase, clamp(0.42 * settings.borderStrength, 0.2, 0.68)),
    '--text-primary': palette.textPrimary,
    '--text-secondary': palette.textSecondary,
    '--text-muted': palette.textMuted,
    '--text-inverse': palette.textInverse,
    '--accent-primary': accentPrimary,
    '--accent-secondary': accentSecondary,
    '--accent-success': palette.success,
    '--accent-warning': palette.warning,
    '--accent-danger': palette.danger,
    '--status-local': palette.danger,
    '--status-syncing': palette.warning,
    '--status-synced': palette.success,
    '--status-error': '#ff5a77',
    '--tag-bg': shiftColor(palette.tagBg, panelAdjust * 0.35),
    '--tag-border': shiftColor(palette.tagBorder, panelAdjust * 0.35),
    '--tag-text': palette.tagText,
    '--shadow-soft': `0 10px 26px ${rgba('#000000', 0.34)}`,
    '--shadow-strong': `0 18px 36px ${rgba('#000000', 0.46)}`,
    '--focus-ring': `0 0 0 3px ${rgba(accentPrimary, 0.42)}`,
    '--surface-blur': `${settings.blurAmount}px`
  };
}

export function applyThemeToDocument(config = {}) {
  if (typeof document === 'undefined') return;

  const themeId = config.themeId || FALLBACK_THEME_ID;
  const themeMode = config.themeMode || 'dark';
  const overrides = config.customThemeOverrides || {};
  const tokens = buildThemeTokens(themeId, themeMode, overrides);

  const root = document.documentElement;
  root.dataset.theme = themeId;
  root.dataset.themeMode = themeMode;
  Object.entries(tokens).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  try {
    localStorage.setItem(
      THEME_CACHE_KEY,
      JSON.stringify({
        themeId,
        themeMode,
        customThemeOverrides: overrides
      })
    );
  } catch {
    // Ignore localStorage errors in restricted contexts.
  }
}

export function applyCachedTheme() {
  if (typeof window === 'undefined') return;

  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) {
      applyThemeToDocument({ themeId: FALLBACK_THEME_ID, themeMode: 'dark', customThemeOverrides: {} });
      return;
    }

    const parsed = JSON.parse(raw);
    applyThemeToDocument(parsed || {});
  } catch {
    applyThemeToDocument({ themeId: FALLBACK_THEME_ID, themeMode: 'dark', customThemeOverrides: {} });
  }
}

export const THEME_OPTIONS = BASE_THEMES.map(({ id, label }) => ({ id, label }));
export const DEFAULT_THEME_ID = FALLBACK_THEME_ID;
