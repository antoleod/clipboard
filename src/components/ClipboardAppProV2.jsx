
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './Header';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useClipboardPermission } from '../hooks/useClipboardPermission';
import { readClipboardSnapshot } from '../services/clipboard';
import { signOutUser, loadUserPreferences, saveUserPreferences } from '../services/authService';
import {
  watchAccessibleClipboardItems,
  createCloudItem,
  updateCloudItem,
  deleteCloudItem,
  buildShareLink
} from '../services/cloudClipboardService';
import { clearApplicationCaches } from '../services/cacheService';
import { detectContentType, computeSensitive, getDomain } from '../features/clipboard/contentIntelligence';
import { buildClipboardSections } from '../features/clipboard/sections';
import { cleanText } from '../features/clipboard/textTools';
import { normalizeItem, mergeById, createItemFromText } from '../features/clipboard/model';
import { sha1Text, normalizeClipboardText } from '../utils/hash';
import { FREE_BYTES, canStore, formatBytes, usageBytes } from '../utils/quota';
import {
  DEFAULT_USER_PREFERENCES,
  mergeUserPreferences,
  normalizeUserPreferences
} from '../features/preferences/userPreferences';
import { THEME_OPTIONS } from '../features/theme/themeSystem';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Text' },
  { id: 'url', label: 'URL' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'json', label: 'JSON' },
  { id: 'code', label: 'Code' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'html', label: 'HTML' },
  { id: 'rich', label: 'Rich' },
  { id: 'image', label: 'Image' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'archived', label: 'Archived' }
];

const EMPTY_COPY = {
  all: ['No clipboard items yet', 'Copy text, links, code or images to start your timeline.'],
  text: ['No text entries yet', 'Copied plain text will appear here.'],
  url: ['No URL entries yet', 'Copied links are grouped here.'],
  email: ['No email entries yet', 'Email addresses are detected automatically.'],
  phone: ['No phone entries yet', 'Phone numbers appear here once copied.'],
  json: ['No JSON entries yet', 'Valid JSON payloads appear in this filter.'],
  code: ['No code snippets captured yet', 'Code-like content is classified automatically.'],
  markdown: ['No markdown entries yet', 'Headings, lists and markdown links appear here.'],
  html: ['No HTML entries yet', 'HTML fragments are shown in this filter.'],
  rich: ['No rich content entries yet', 'Mixed rich text snippets appear here.'],
  image: ['No image entries yet', 'Clipboard images show with media previews.'],
  pinned: ['No pinned items yet', 'Pin important entries for quick access.'],
  archived: ['No archived items', 'Archive old entries to keep timeline clean.']
};

const CAPTURE_DEBOUNCE_MS = 260;
const CAPTURE_REPEAT_GUARD_MS = 1200;
const SYNC_FLASH_MS = 2200;
const INITIAL_RENDER_WINDOW = 72;
const RENDER_WINDOW_STEP = 40;

function toMessage(error) {
  return error instanceof Error && error.message ? error.message : 'Action failed.';
}

function normalizeForSearch(item) {
  return [
    item.content,
    item.preview,
    item.contentType,
    item.typeTags && item.typeTags.join(' '),
    item.details && item.details.title,
    item.details && item.details.tags && item.details.tags.join(' ')
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function itemIcon(contentType) {
  const map = {
    text: 'TEXT',
    url: 'LINK',
    email: 'MAIL',
    phone: 'PHONE',
    json: 'JSON',
    code: 'CODE',
    markdown: 'MD',
    html: 'HTML',
    rich: 'RICH',
    image: 'IMG'
  };
  return map[contentType] || 'TEXT';
}

function timeout(ms) {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('timeout')), ms);
  });
}

function isTypeMatch(item, filterId) {
  if (filterId === 'all') return true;
  if (filterId === 'pinned') return Boolean(item.pinned);
  if (filterId === 'archived') return Boolean(item.archived);
  if (item.contentType === filterId) return true;
  return Array.isArray(item.typeTags) ? item.typeTags.includes(filterId) : false;
}

function captureStateText(autoCapture, permissionState) {
  if (!autoCapture) return 'Paused';
  if (permissionState === 'unsupported') return 'Browser limited';
  if (permissionState === 'granted') return 'Active';
  return 'Waiting for permission';
}

function emptyStateCopy(filterId, query, autoCapture, permissionState) {
  if (query) {
    return {
      title: 'No results for your search',
      hint: 'Try another keyword or remove filters.'
    };
  }

  if (autoCapture && permissionState === 'denied') {
    return {
      title: 'Clipboard capture blocked',
      hint: 'Enable clipboard access to resume automatic capture.'
    };
  }

  const pair = EMPTY_COPY[filterId] || EMPTY_COPY.all;
  return {
    title: pair[0],
    hint: pair[1]
  };
}

export default function ClipboardAppProV2() {
  const { user, profile, keepSignedIn, setKeepSignedIn } = useAuth();
  const [localItems, setLocalItems] = useLocalStorage('clipboard-vault-local-items', []);
  const [settingsCache, setSettingsCache] = useLocalStorage('clipboard-vault-settings', DEFAULT_USER_PREFERENCES);
  const [preferences, setPreferences] = useState(() =>
    mergeUserPreferences(DEFAULT_USER_PREFERENCES, settingsCache || {})
  );
  const [preferencesReady, setPreferencesReady] = useState(false);

  const [cloudItems, setCloudItems] = useState([]);
  const [status, setStatus] = useState('Ready.');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState(() => settingsCache?.activeFilters?.[0] || 'all');
  const [searchInput, setSearchInput] = useState('');
  const [openFooterPanel, setOpenFooterPanel] = useState(null);
  const toggleFooter = (panel) => setOpenFooterPanel((prev) => (prev === panel ? null : panel));
  const [archiveCollapsed, setArchiveCollapsed] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [toast, setToast] = useState(null);
  const [syncFlash, setSyncFlash] = useState({});
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_WINDOW);

  const lastHashRef = useRef('');
  const lastCaptureAtRef = useRef(0);
  const captureDebounceRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const pollTimerRef = useRef(null);
  const suppressCaptureUntilRef = useRef(0);
  const suppressCaptureHashRef = useRef('');
  const timelineRef = useRef(null);

  const {
    permissionState,
    permissionCopy,
    canReadClipboard,
    requestPermission,
    refreshPermission
  } = useClipboardPermission();

  const search = useDebouncedValue(searchInput, 220);
  const debouncedPreferences = useDebouncedValue(preferences, 420);

  useTheme(preferences.themeId, preferences.themeMode, preferences.customThemeOverrides);

  const updatePreferences = useCallback((nextValue) => {
    setPreferences((prev) => {
      const merged = typeof nextValue === 'function' ? nextValue(prev) : { ...prev, ...nextValue };
      return normalizeUserPreferences(merged);
    });
  }, []);

  const handleFilterChange = useCallback((nextFilter) => {
    setFilter(nextFilter);
    updatePreferences((prev) => ({ ...prev, activeFilters: [nextFilter] }));
  }, [updatePreferences]);
  useEffect(() => {
    let active = true;
    const localBaseline = mergeUserPreferences(DEFAULT_USER_PREFERENCES, settingsCache || {});

    setPreferences(localBaseline);
    setPreferencesReady(false);

    loadUserPreferences(user.uid)
      .then((remotePreferences) => {
        if (!active) return;
        const merged = mergeUserPreferences(localBaseline, remotePreferences || {});
        setPreferences(merged);
        setFilter(merged.activeFilters?.[0] || 'all');
        setSettingsCache(merged);
      })
      .finally(() => {
        if (active) setPreferencesReady(true);
      });

    return () => {
      active = false;
    };
  }, [setSettingsCache, settingsCache, user.uid]);

  useEffect(() => {
    updatePreferences((prev) => (prev.keepSignedIn === keepSignedIn ? prev : { ...prev, keepSignedIn }));
  }, [keepSignedIn, updatePreferences]);

  useEffect(() => {
    if (!preferencesReady || !user.uid) return;

    setSettingsCache(debouncedPreferences);
    saveUserPreferences(user.uid, debouncedPreferences).catch(() => {
      setError('Could not persist preferences. Working from local cache.');
    });
  }, [debouncedPreferences, preferencesReady, setSettingsCache, user.uid]);

  useEffect(() => {
    let active = true;
    setStatus('Loading cloud data...');

    const fallback = window.setTimeout(() => {
      if (active) setStatus('Cloud delayed. Using local cache.');
    }, 5000);

    const stop = watchAccessibleClipboardItems(
      user,
      (items) => {
        if (!active) return;
        window.clearTimeout(fallback);
        setCloudItems(items);
        setStatus('Cloud connected.');
      },
      () => {
        if (!active) return;
        setError('Cloud sync unavailable. Local mode active.');
        setStatus('Using local cache.');
      }
    );

    return () => {
      active = false;
      window.clearTimeout(fallback);
      stop();
    };
  }, [user]);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const local = useMemo(
    () =>
      localItems.map((item) =>
        normalizeItem(item, {
          scope: 'local',
          ownerId: user.uid,
          ownerEmail: user.email
        })
      ),
    [localItems, user.email, user.uid]
  );

  const cloud = useMemo(() => cloudItems.map((item) => normalizeItem(item, { scope: item.scope })), [cloudItems]);
  const items = useMemo(() => mergeById(local, cloud), [cloud, local]);
  const localUsage = useMemo(() => usageBytes(local), [local]);

  const pendingCount = useMemo(() => local.filter((item) => item.pendingSync).length, [local]);
  const syncErrorCount = useMemo(() => local.filter((item) => item.lastSyncError).length, [local]);

  const ownerCloudByHash = useMemo(() => {
    const map = new Map();
    cloud.forEach((item) => {
      if (item.ownerId === user.uid && item.contentHash) map.set(item.contentHash, item);
    });
    return map;
  }, [cloud, user.uid]);

  const smartFilters = useMemo(() => {
    const counts = {};
    const lastCopied = {};

    FILTERS.forEach(f => {
      counts[f.id] = 0;
      lastCopied[f.id] = 0;
    });

    items.forEach(item => {
      FILTERS.forEach(f => {
        if (isTypeMatch(item, f.id)) {
          counts[f.id]++;
          const time = new Date(item.lastCopiedAt || item.updatedAt || item.createdAt).getTime();
          if (time > lastCopied[f.id]) {
            lastCopied[f.id] = time;
          }
        }
      });
    });

    let active = FILTERS.filter(f => f.id === 'all' || counts[f.id] > 0);
    active.sort((a, b) => {
      if (a.id === 'all') return -1;
      if (b.id === 'all') return 1;
      return lastCopied[b.id] - lastCopied[a.id];
    });

    return { active, counts };
  }, [items]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    const list = items.filter((item) => {
      if (!isTypeMatch(item, filter)) return false;
      if (!query) return true;
      return normalizeForSearch(item).includes(query);
    });

    return list.sort((a, b) => {
      const aTime = new Date(a.lastCopiedAt || a.updatedAt || a.createdAt).getTime();
      const bTime = new Date(b.lastCopiedAt || b.updatedAt || b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [filter, items, search]);

  const sections = useMemo(() => buildClipboardSections(filtered, { archiveCollapsed }), [archiveCollapsed, filtered]);
  const sectionTotalCount = useMemo(() => Object.values(sections).reduce((sum, values) => sum + values.length, 0), [sections]);



  useEffect(() => {
    setVisibleCount(INITIAL_RENDER_WINDOW);
  }, [archiveCollapsed, filter, search]);

  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return () => { };

    const onScroll = () => {
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 140) {
        setVisibleCount((prev) => Math.min(sectionTotalCount, prev + RENDER_WINDOW_STEP));
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [sectionTotalCount]);

  const stats = useMemo(
    () => ({
      total: items.length,
      synced: items.filter((item) => item.scope === 'synced').length,
      pinned: items.filter((item) => item.pinned).length,
      frequent: items.filter((item) => (item.usageCount || item.copyCount || 0) > 2).length
    }),
    [items]
  );

  const captureState = useMemo(
    () => captureStateText(preferences.autoCapture, permissionState),
    [permissionState, preferences.autoCapture]
  );

  const syncSummary = useMemo(() => {
    if (!isOnline) return 'Offline - saving locally';
    if (isSyncing && pendingCount > 0) return `Syncing ${pendingCount} items...`;
    if (syncErrorCount > 0) return 'Sync error - retrying';
    if (pendingCount > 0) return `${pendingCount} items pending`;
    return 'Synced';
  }, [isOnline, isSyncing, pendingCount, syncErrorCount]);
  const flashSynced = useCallback((id) => {
    if (!id) return;
    setSyncFlash((prev) => ({ ...prev, [id]: true }));
    window.setTimeout(() => {
      setSyncFlash((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, SYNC_FLASH_MS);
  }, []);

  const buildHashedItem = useCallback(
    async (item) => {
      const normalized = normalizeItem(item, {
        scope: item.scope || preferences.captureTarget,
        ownerId: user.uid,
        ownerEmail: user.email
      });
      const normalizedText = normalized.kind === 'text'
        ? normalizeClipboardText(normalized.content)
        : `${normalized.kind}:${normalized.preview}`;
      const contentHash = normalized.contentHash || (await sha1Text(normalizedText));

      return {
        ...normalized,
        content: normalized.kind === 'text' ? normalizedText : normalized.content,
        preview: normalized.kind === 'text' ? normalizedText.slice(0, 120) : normalized.preview,
        contentHash,
        sensitive: normalized.sensitive ?? computeSensitive(normalized)
      };
    },
    [preferences.captureTarget, user.email, user.uid]
  );

  const upsertLocalItem = useCallback(
    async (item, options = {}) => {
      const hashed = await buildHashedItem(item);
      const nowIso = new Date().toISOString();

      setLocalItems((arr) => {
        const normalizedArr = arr.map((value) => normalizeItem(value, { scope: 'local', ownerId: user.uid, ownerEmail: user.email }));
        const existingIndex = normalizedArr.findIndex((value) => value.contentHash && value.contentHash === hashed.contentHash);

        if (existingIndex >= 0) {
          const existing = normalizedArr[existingIndex];
          const updated = {
            ...existing,
            ...hashed,
            pendingSync: options.pendingSync ?? existing.pendingSync,
            lastSyncError: options.lastSyncError || '',
            syncState: options.syncState || (options.pendingSync ? 'pending-sync' : 'local-only'),
            usageCount: Number(existing.usageCount || existing.copyCount || 0) + 1,
            copyCount: Number(existing.copyCount || existing.usageCount || 0) + 1,
            updatedAt: nowIso,
            lastCopiedAt: nowIso
          };
          const next = normalizedArr.filter((_, index) => index !== existingIndex);
          return [updated, ...next];
        }

        const nextItem = {
          ...hashed,
          scope: 'local',
          pendingSync: Boolean(options.pendingSync),
          lastSyncError: options.lastSyncError || '',
          syncState: options.syncState || (options.pendingSync ? 'pending-sync' : 'local-only'),
          usageCount: 1,
          copyCount: 1,
          updatedAt: nowIso,
          lastCopiedAt: nowIso
        };

        if (!canStore(normalizedArr, nextItem, FREE_BYTES)) {
          setError('Local cache limit reached. Clear cache or sync pending items.');
          return normalizedArr;
        }

        return [nextItem, ...normalizedArr];
      });

      return hashed;
    },
    [buildHashedItem, setLocalItems, user.email, user.uid]
  );

  const upsertCloudItem = useCallback(
    async (item, options = {}) => {
      const hashed = await buildHashedItem(item);
      const existing = hashed.contentHash ? ownerCloudByHash.get(hashed.contentHash) : null;

      if (existing) {
        const baseUsage = Number(existing.usageCount || existing.copyCount || 0);
        const nextUsage = baseUsage + (options.incrementUsage === false ? 0 : 1);
        await updateCloudItem(user, existing.id, {
          content: hashed.content,
          preview: hashed.preview,
          contentType: hashed.contentType,
          typeTags: hashed.typeTags,
          contentHash: hashed.contentHash,
          archived: Boolean(hashed.archived),
          pinned: Boolean(hashed.pinned),
          usageCount: nextUsage,
          copyCount: nextUsage,
          lastCopiedAt: new Date().toISOString()
        });
        flashSynced(existing.id);
        return existing.id;
      }

      const id = await createCloudItem(
        user,
        {
          ...hashed,
          usageCount: Math.max(1, Number(hashed.usageCount || 0)),
          copyCount: Math.max(1, Number(hashed.copyCount || 0)),
          lastCopiedAt: new Date().toISOString()
        },
        { visibility: 'personal' }
      );

      flashSynced(id);
      return id;
    },
    [buildHashedItem, flashSynced, ownerCloudByHash, user]
  );

  const syncPendingLocal = useCallback(
    async ({ manual = false, silent = false } = {}) => {
      if (!user.uid || syncInFlightRef.current || !isOnline) return { synced: 0, failed: 0 };

      syncInFlightRef.current = true;
      setIsSyncing(true);

      const candidates = local.filter((item) => (manual ? !item.archived : item.pendingSync));
      let synced = 0;
      let failed = 0;

      try {
        for (const item of candidates) {
          setLocalItems((arr) => arr.map((value) => (value.id === item.id ? { ...value, syncState: 'syncing', lastSyncError: '' } : value)));
          try {
            await upsertCloudItem({ ...item, scope: 'synced' }, { incrementUsage: false });
            synced += 1;
            setLocalItems((arr) => arr.filter((value) => value.id !== item.id));
          } catch (syncError) {
            failed += 1;
            setLocalItems((arr) =>
              arr.map((value) => (
                value.id === item.id
                  ? { ...value, pendingSync: true, syncState: 'sync-error', lastSyncError: toMessage(syncError) }
                  : value
              ))
            );
          }
        }

        if (!silent) {
          if (synced > 0) setStatus(`Synced ${synced} item(s).`);
          if (failed > 0) setError(`${failed} item(s) could not sync yet.`);
        }

        return { synced, failed };
      } finally {
        syncInFlightRef.current = false;
        setIsSyncing(false);
      }
    },
    [isOnline, local, setLocalItems, upsertCloudItem, user.uid]
  );

  const runSyncCycle = useCallback(
    async ({ manual = false, silent = false } = {}) => {
      if (!user.uid) return;
      if (!manual && !preferences.autoSyncPending) return;

      try {
        await Promise.race([syncPendingLocal({ manual, silent }), timeout(5200)]);
      } catch {
        if (!silent) setStatus('Sync timeout. Working from local cache.');
      }
    },
    [preferences.autoSyncPending, syncPendingLocal, user.uid]
  );

  const captureSnapshot = useCallback(
    async (snapshot, reason = 'capture') => {
      if (!snapshot || !snapshot.content) return;

      const candidate = normalizeItem(
        {
          kind: snapshot.kind || 'text',
          content: snapshot.content,
          preview: snapshot.preview || String(snapshot.content).slice(0, 120),
          source: reason,
          scope: preferences.captureTarget,
          contentType: detectContentType(snapshot),
          sensitive: computeSensitive(snapshot)
        },
        { scope: preferences.captureTarget, ownerId: user.uid, ownerEmail: user.email }
      );

      const hashed = await buildHashedItem(candidate);
      const now = Date.now();

      if (now < suppressCaptureUntilRef.current && hashed.contentHash && hashed.contentHash === suppressCaptureHashRef.current) {
        return;
      }

      if (hashed.contentHash && lastHashRef.current === hashed.contentHash && now - lastCaptureAtRef.current < CAPTURE_REPEAT_GUARD_MS) {
        return;
      }

      lastHashRef.current = hashed.contentHash;
      lastCaptureAtRef.current = now;

      if (preferences.captureTarget === 'synced' && isOnline) {
        await upsertCloudItem(hashed);
        setStatus('Captured and synced.');
      } else {
        await upsertLocalItem(hashed, {
          pendingSync: preferences.captureTarget === 'synced',
          syncState: preferences.captureTarget === 'synced' ? 'pending-sync' : 'local-only',
          lastSyncError: preferences.captureTarget === 'synced' ? 'Waiting for sync.' : ''
        });
        setStatus(preferences.captureTarget === 'synced' ? 'Captured locally. Pending sync.' : 'Captured locally.');
      }

      if (preferences.autoSyncPending || preferences.captureTarget === 'synced') {
        runSyncCycle({ silent: true });
      }
    },
    [buildHashedItem, isOnline, preferences.autoSyncPending, preferences.captureTarget, runSyncCycle, upsertCloudItem, upsertLocalItem, user.email, user.uid]
  );

  const scheduleCapture = useCallback(
    (reason = 'event', eventText = '') => {
      if (captureDebounceRef.current) window.clearTimeout(captureDebounceRef.current);

      captureDebounceRef.current = window.setTimeout(async () => {
        const directText = normalizeClipboardText(eventText);
        if (directText) {
          await captureSnapshot({ kind: 'text', content: directText, preview: directText.slice(0, 120) }, reason);
          return;
        }

        if (!canReadClipboard) {
          setStatus('Auto capture waiting for clipboard permission.');
          return;
        }

        try {
          const snapshot = await readClipboardSnapshot();
          await captureSnapshot(snapshot, reason);
        } catch (captureError) {
          if (reason !== 'poll') setError(toMessage(captureError));
        }
      }, CAPTURE_DEBOUNCE_MS);
    },
    [canReadClipboard, captureSnapshot]
  );
  useEffect(() => {
    const onCopyCut = (event) => {
      if (!preferences.autoCapture) return;
      const text = event.clipboardData && event.clipboardData.getData('text/plain');
      scheduleCapture(event.type, text || '');
    };

    const onFocus = () => {
      refreshPermission();
      if (preferences.autoCapture) scheduleCapture('focus');
      runSyncCycle({ silent: true });
    };

    const onVisibility = () => {
      if (!document.hidden) {
        refreshPermission();
        if (preferences.autoCapture) scheduleCapture('visible');
        runSyncCycle({ silent: true });
      }
    };

    document.addEventListener('copy', onCopyCut);
    document.addEventListener('cut', onCopyCut);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onFocus);

    runSyncCycle({ silent: true });

    return () => {
      document.removeEventListener('copy', onCopyCut);
      document.removeEventListener('cut', onCopyCut);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onFocus);
    };
  }, [preferences.autoCapture, refreshPermission, runSyncCycle, scheduleCapture]);

  useEffect(() => {
    if (!preferences.autoCapture || !canReadClipboard) return;

    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(() => {
      if (document.hidden) return;
      scheduleCapture('poll');
    }, 1000);

    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, [canReadClipboard, preferences.autoCapture, preferences.captureIntervalSec, scheduleCapture]);

  useEffect(() => () => {
    if (captureDebounceRef.current) window.clearTimeout(captureDebounceRef.current);
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
  }, []);

  const updateItem = useCallback(
    async (item, patch) => {
      if (item.scope === 'local') {
        setLocalItems((arr) => arr.map((value) => (value.id === item.id ? { ...value, ...patch, updatedAt: new Date().toISOString() } : value)));
        return;
      }

      if (item.ownerId === user.uid) {
        await updateCloudItem(user, item.id, patch);
        flashSynced(item.id);
      }
    },
    [flashSynced, setLocalItems, user]
  );

  const copyItem = useCallback(
    async (item) => {
      if (item.kind === 'image') return;

      const text = String(item.content || '');
      const hash = await sha1Text(normalizeClipboardText(text));
      suppressCaptureHashRef.current = hash;
      suppressCaptureUntilRef.current = Date.now() + CAPTURE_REPEAT_GUARD_MS;
      await navigator.clipboard.writeText(text);

      const nextUsage = Number(item.usageCount || item.copyCount || 0) + 1;
      await updateItem(item, { usageCount: nextUsage, copyCount: nextUsage, lastCopiedAt: new Date().toISOString() });
    },
    [updateItem]
  );

  const removeItem = useCallback(
    async (item) => {
      if (item.scope === 'local') {
        setLocalItems((arr) => arr.filter((value) => value.id !== item.id));
        return;
      }
      await deleteCloudItem(item.id);
    },
    [setLocalItems]
  );

  const archiveItem = useCallback(async (item, nextValue) => {
    await updateItem(item, { archived: nextValue });
  }, [updateItem]);

  const deleteWithUndo = useCallback(
    async (item) => {
      await removeItem(item);
      setToast({
        text: 'Item deleted',
        undo: async () => {
          if (item.scope === 'local') {
            setLocalItems((arr) => [item, ...arr]);
            return;
          }
          await createCloudItem(user, item, { visibility: item.visibility || 'personal' });
        }
      });
    },
    [removeItem, setLocalItems, user]
  );

  const archiveWithUndo = useCallback(
    async (item) => {
      await archiveItem(item, true);
      setToast({ text: 'Item archived', undo: () => archiveItem(item, false) });
    },
    [archiveItem]
  );

  const saveManual = useCallback(async () => {
    const text = normalizeClipboardText(manualText);
    if (!text) return;
    await captureSnapshot(createItemFromText(text, 'manual'), 'manual');
    setManualText('');
  }, [captureSnapshot, manualText]);

  const clearCache = useCallback(async () => {
    await clearApplicationCaches(user.uid);
    setLocalItems([]);
    setStatus('Local cache cleared.');
  }, [setLocalItems, user.uid]);

  const shareItem = useCallback((item) => {
    navigator.clipboard.writeText(buildShareLink(item.id));
  }, []);

  const resolveSyncState = useCallback(
    (item) => {
      if (item.scope === 'local') {
        if (item.lastSyncError) return 'sync-error';
        if (item.pendingSync && isSyncing) return 'syncing';
        if (item.pendingSync) return 'pending-sync';
        return 'local-only';
      }
      if (syncFlash[item.id]) return 'synced-recent';
      return 'synced';
    },
    [isSyncing, syncFlash]
  );

  const resultItems = useMemo(() => filtered.slice(0, 30), [filtered]);
  const showPermissionBanner = preferences.autoCapture && permissionState !== 'granted';
  const emptyState = emptyStateCopy(filter, search.trim(), preferences.autoCapture, permissionState);

  return (
    <div className={preferences.compactMode ? 'layout density-compact' : 'layout density-comfortable'} style={{ '--font-scale': preferences.fontScale }}>
      <Header
        onSignOut={signOutUser}
        onExport={() => {
          const data = JSON.stringify({ localItems, preferences: normalizeUserPreferences(preferences) }, null, 2);
          const blob = new Blob([data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'clipboard-export.json';
          a.click();
          URL.revokeObjectURL(url);
        }}
        onToggleSettings={() => setSettingsOpen((value) => !value)}
        user={user}
        profile={profile}
        syncSummary={syncSummary}
        isOnline={isOnline}
      />

      <section className='status-line' role='status' aria-live='polite'>
        <div className='status-main'>
          <strong>{syncSummary}</strong>
          <span>{status}</span>
          {error ? <span className='status-error'>{error}</span> : null}
        </div>
        <div className='status-right'>
          {!isOnline ? <span className='status-badge danger'>Offline</span> : null}
          {pendingCount ? <span className='status-badge warning'>Pending {pendingCount}</span> : null}
          <span className='status-badge neutral'>Auto capture: {captureState}</span>
          <span className='status-badge neutral'>Storage {formatBytes(localUsage)}</span>
        </div>
      </section>

      {showPermissionBanner ? (
        <section className='permission-banner' role='alert'>
          <div>
            <strong>{permissionCopy.title}</strong>
            <p>{permissionCopy.help}</p>
            <small>Auto capture is enabled but currently blocked.</small>
          </div>
          <div className='permission-actions'>
            <button className='btn-strong' onClick={requestPermission}>Enable clipboard access</button>
            <button className='btn' onClick={refreshPermission}>Retry permission</button>
          </div>
        </section>
      ) : null}

      <section className='stats-chips'>
        <span>TOTAL {stats.total}</span>
        <span>SYNCED {stats.synced}</span>
        <span>PINNED {stats.pinned}</span>
        <span>HOT {stats.frequent}</span>
      </section>
      <main className='content'>
        <section className='feed panel-surface'>
          <div className='feed-head'>
            <h2>Timeline</h2>
            <div className='filters'>
              {smartFilters.active.map((entry) => (
                <button key={entry.id} className={filter === entry.id ? 'chip active' : 'chip'} onClick={() => handleFilterChange(entry.id)}>
                  {entry.label}
                  {smartFilters.counts[entry.id] > 0 && <small>{smartFilters.counts[entry.id]}</small>}
                </button>
              ))}
              {filter !== 'all' && (
                <button className='chip clear-filter' onClick={() => handleFilterChange('all')}>
                  Clear all ✕
                </button>
              )}
            </div>
          </div>

          <div className='tools-bar'>
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder='Search content, tags, type, date...' />
            <button className='btn' onClick={() => setCommandOpen(true)}>Ctrl+K</button>
          </div>

          <div className='timeline-scroll' ref={timelineRef}>
            {sectionTotalCount === 0 ? (
              <div className='empty-state'>
                <h3>{emptyState.title}</h3>
                <p>{emptyState.hint}</p>
              </div>
            ) : Object.entries(sections).map(([section, sectionItems]) => {
              if (!sectionItems.length) return null;
              const visibleItems = sectionItems.slice(0, visibleCount);
              if (!visibleItems.length) return null;

              return (
                <div key={section} className='timeline-section'>
                  <h3 className='timeline-label'>
                    {section}
                    {section === 'ARCHIVE' ? (
                      <button className='mini-action' onClick={() => setArchiveCollapsed((value) => !value)}>
                        {archiveCollapsed ? 'Expand' : 'Collapse'}
                      </button>
                    ) : null}
                  </h3>

                  {visibleItems.map((entry) => {
                    const syncState = resolveSyncState(entry);
                    const domain = entry.contentType === 'url' ? getDomain(String(entry.content || '')) : '';
                    return (
                      <article key={entry.id} className={`entry type-${entry.contentType}${entry.pinned ? ' is-pinned' : ''}`} onClick={() => copyItem(entry)}>
                        <div className='entry-head'>
                          <div>
                            <div className='entry-badges'>
                              <span className={`sync-dot sync-${syncState}`} />
                              <span className='entry-kind'>{itemIcon(entry.contentType)} {entry.contentType}</span>
                              {entry.typeTags && entry.typeTags.map((tag) => <span className='scope-pill' key={`${entry.id}-${tag}`}>{tag}</span>)}
                              {entry.pinned ? <span className='scope-pill'>pinned</span> : null}
                              {entry.archived ? <span className='scope-pill'>archived</span> : null}
                            </div>
                            <h3>{(entry.details && entry.details.title) || entry.preview || 'Clipboard entry'}</h3>
                            <p className='entry-meta'>
                              {new Date(entry.updatedAt || entry.createdAt).toLocaleString()} | used {entry.usageCount || entry.copyCount || 0}x
                            </p>
                          </div>
                        </div>

                        <div className={preferences.blurSensitiveContent && entry.sensitive ? 'entry-preview blur-sensitive' : 'entry-preview'}>
                          {preferences.hidePreviews ? <div className='preview-muted'>Preview hidden</div> : null}
                          {!preferences.hidePreviews && entry.kind === 'image' ? <img className='entry-image' src={entry.content} alt='Clipboard image' loading='lazy' /> : null}
                          {!preferences.hidePreviews && entry.kind !== 'image' && entry.contentType === 'url' ? (
                            <div className='url-preview'>
                              <strong>{domain || 'Link'}</strong>
                              <a href={String(entry.content)} target='_blank' rel='noreferrer' onClick={(event) => event.stopPropagation()}>{String(entry.content)}</a>
                            </div>
                          ) : null}
                          {!preferences.hidePreviews && entry.kind !== 'image' && ['json', 'code', 'html'].includes(entry.contentType) ? <pre className='preview-code'>{cleanText(entry.content)}</pre> : null}
                          {!preferences.hidePreviews && entry.kind !== 'image' && !['json', 'code', 'html', 'url'].includes(entry.contentType) ? <pre>{entry.content}</pre> : null}
                        </div>

                        <div className='entry-foot'>
                          <button className='mini-action' onClick={(event) => { event.stopPropagation(); copyItem(entry); }}>Copy</button>
                          <button className='mini-action' onClick={(event) => { event.stopPropagation(); updateItem(entry, { pinned: !entry.pinned }); }}>{entry.pinned ? 'Unpin' : 'Pin'}</button>
                          <button className='mini-action' onClick={(event) => { event.stopPropagation(); archiveWithUndo(entry); }}>Archive</button>
                          <button className='mini-action' onClick={(event) => { event.stopPropagation(); deleteWithUndo(entry); }}>Delete</button>
                          {entry.scope !== 'local' ? <button className='mini-action' onClick={(event) => { event.stopPropagation(); shareItem(entry); }}>Share</button> : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              );
            })}

            {visibleCount < sectionTotalCount ? (
              <button className='btn' onClick={() => setVisibleCount((prev) => Math.min(sectionTotalCount, prev + RENDER_WINDOW_STEP))}>Load more</button>
            ) : null}
          </div>
        </section>

        <footer className='footer-fixed panel-surface'>
          <div className='footer-actions'>
            <button className={openFooterPanel === 'account' ? 'btn active' : 'btn'} onClick={() => toggleFooter('account')}>Account</button>
            <button className={openFooterPanel === 'sync' ? 'btn active' : 'btn'} onClick={() => toggleFooter('sync')}>Sync</button>
            <button className={openFooterPanel === 'capture' ? 'btn active' : 'btn'} onClick={() => toggleFooter('capture')}>Capture</button>
            <button className={openFooterPanel === 'display' ? 'btn active' : 'btn'} onClick={() => toggleFooter('display')}>Display</button>
            <button className='btn-strong' disabled={!isOnline || isSyncing} onClick={() => runSyncCycle({ manual: true })}>{isSyncing ? 'Sync...' : 'Force Sync'}</button>
          </div>

          {openFooterPanel === 'account' && (
            <div className='footer-panel'>
              <div className='panel-block'>
                <h4>ACCOUNT</h4>
                <p>{(profile && profile.displayName) || user.displayName || 'User'}</p>
                <p>{(profile && profile.email) || user.email || '-'}</p>
                <label className='switch'>
                  <input type='checkbox' checked={keepSignedIn} onChange={(e) => { setKeepSignedIn(e.target.checked); updatePreferences({ keepSignedIn: e.target.checked }); }} />
                  Keep signed in
                </label>
                <p>Quota: {formatBytes(usageBytes(localItems))} / {formatBytes(FREE_BYTES)}</p>
                <button className='btn' onClick={clearCache}>Clear Context</button>
              </div>
            </div>
          )}

          {openFooterPanel === 'sync' && (
            <div className='footer-panel'>
              <div className='panel-block'>
                <h4>SYNC</h4>
                <p>{syncSummary}</p>
                <label className='switch'>
                  <input type='checkbox' checked={preferences.autoSyncPending} onChange={(e) => updatePreferences({ autoSyncPending: e.target.checked })} />
                  Auto-sync local
                </label>
              </div>
            </div>
          )}

          {openFooterPanel === 'capture' && (
            <div className='footer-panel'>
              <div className='panel-block'>
                <h4>CAPTURE</h4>
                <label className='switch'>
                  <input type='checkbox' checked={preferences.autoCapture} onChange={(e) => updatePreferences({ autoCapture: e.target.checked })} />
                  Auto capture
                </label>
                <label>
                  Capture target
                  <select value={preferences.captureTarget} onChange={(event) => updatePreferences({ captureTarget: event.target.value })}>
                    <option value='synced'>Synced</option>
                    <option value='local'>Local</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {openFooterPanel === 'display' && (
            <div className='footer-panel'>
              <div className='panel-block'>
                <h4>DISPLAY</h4>
                <label className='switch'>
                  <input type='checkbox' checked={preferences.compactMode} onChange={(e) => updatePreferences({ compactMode: e.target.checked })} />
                  Compact mode
                </label>
                <label className='switch'>
                  <input type='checkbox' checked={preferences.hidePreviews} onChange={(event) => updatePreferences({ hidePreviews: event.target.checked })} />
                  Hide previews
                </label>
              </div>
            </div>
          )}
        </footer>
      </main>

      {commandOpen ? (
        <div className='modal-backdrop' onClick={() => setCommandOpen(false)}>
          <div className='command-palette' onClick={(event) => event.stopPropagation()}>
            <h3>Quick search</h3>
            <input autoFocus value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder='Search by content, tags, type, date...' />
            <ul>
              {resultItems.map((item) => (
                <li key={item.id}>
                  <button onClick={() => { copyItem(item); setCommandOpen(false); }}>{itemIcon(item.contentType)} {item.preview || String(item.content).slice(0, 80)}</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className='toast'>
          <span>{toast.text}</span>
          <button className='mini-action' onClick={() => { toast.undo && toast.undo(); setToast(null); }}>Undo</button>
          <button className='mini-action' onClick={() => setToast(null)}>Close</button>
        </div>
      ) : null}
    </div>
  );
}
