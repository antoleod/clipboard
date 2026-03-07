import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './Header';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { readClipboardSnapshot } from '../services/clipboard';
import { signOutUser } from '../services/authService';
import {
  watchAccessibleClipboardItems,
  createCloudItem,
  updateCloudItem,
  deleteCloudItem,
  buildShareLink
} from '../services/cloudClipboardService';
import { clearApplicationCaches } from '../services/cacheService';
import { detectContentType } from '../features/clipboard/contentIntelligence';
import { buildClipboardSections } from '../features/clipboard/sections';
import { cleanText } from '../features/clipboard/textTools';
import { normalizeItem, mergeById, createItemFromText } from '../features/clipboard/model';
import { sha1Text, normalizeClipboardText } from '../utils/hash';
import { FREE_BYTES, canStore, formatBytes, usageBytes } from '../utils/quota';

const SETTINGS_DEFAULT = {
  theme: 'midnight-vault',
  autoCapture: true,
  pollingMs: 3500,
  quotaBytes: FREE_BYTES,
  captureTarget: 'synced',
  keepSignedIn: true,
  blurSensitive: false,
  hidePreviews: false,
  autoSyncLocal: true,
  sharingDefaultVisibility: 'personal',
  settingsVersion: 3
};

const THEMES = [
  ['midnight-vault', 'Midnight Vault'],
  ['ep-dark-blue', 'EP Dark Blue'],
  ['matrix-green', 'Matrix Green'],
  ['slate-graphite', 'Slate Graphite'],
  ['arctic-dark', 'Arctic Dark']
];

const FILTERS = ['all', 'text', 'url', 'email', 'phone', 'json', 'code', 'image', 'markdown', 'pinned', 'archived'];
const CAPTURE_DEBOUNCE_MS = 320;
const CAPTURE_REPEAT_GUARD_MS = 1200;
const SYNC_FLASH_MS = 2400;
const LONG_PRESS_MS = 520;
const INITIAL_RENDER_WINDOW = 80;
const RENDER_WINDOW_STEP = 40;

const toMsg = (e) => (e instanceof Error && e.message ? e.message : 'Action failed.');

function itemIcon(item) {
  const map = {
    url: 'LINK',
    email: 'MAIL',
    phone: 'CALL',
    json: 'JSON',
    code: 'CODE',
    image: 'IMG',
    markdown: 'MD'
  };
  return map[item.contentType] || 'TEXT';
}

function timeout(ms) {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error('timeout')), ms);
  });
}

function normalizeForSearch(item) {
  return [
    item.content,
    item.preview,
    item.contentType,
    item.details?.title,
    item.details?.tags?.join(' '),
    new Date(item.updatedAt || item.createdAt).toLocaleDateString()
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function ClipboardAppPro() {
  const { user, profile, keepSignedIn, setKeepSignedIn } = useAuth();
  const [localItems, setLocalItems] = useLocalStorage('clipboard-vault-local-items', []);
  const [settings, setSettings] = useLocalStorage('clipboard-vault-settings', SETTINGS_DEFAULT);
  const [cloudItems, setCloudItems] = useState([]);
  const [status, setStatus] = useState('Ready.');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveCollapsed, setArchiveCollapsed] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [toast, setToast] = useState(null);
  const [swipeOffsets, setSwipeOffsets] = useState({});
  const [syncFlash, setSyncFlash] = useState({});
  const [visibleCount, setVisibleCount] = useState(INITIAL_RENDER_WINDOW);

  const lastHashRef = useRef('');
  const lastCaptureAtRef = useRef(0);
  const captureDebounceRef = useRef(null);
  const syncInFlightRef = useRef(false);
  const pollTimerRef = useRef(null);
  const swipeStartRef = useRef({});
  const longPressTimerRef = useRef({});
  const longPressTriggeredRef = useRef({});
  const suppressCaptureUntilRef = useRef(0);
  const suppressCaptureHashRef = useRef('');
  const timelineRef = useRef(null);
  const ignoreClickUntilRef = useRef(0);

  const search = useDebouncedValue(searchInput, 220);
  const prefs = { ...SETTINGS_DEFAULT, ...settings, keepSignedIn };
  useTheme(prefs.theme);

  useEffect(() => {
    setSettings((prev) => {
      const next = { ...SETTINGS_DEFAULT, ...prev, keepSignedIn };
      if ((prev?.settingsVersion ?? 0) < 3) {
        next.captureTarget = 'synced';
        next.autoSyncLocal = true;
        next.theme = next.theme || 'midnight-vault';
        next.settingsVersion = 3;
      }
      return next;
    });
  }, [keepSignedIn, setSettings]);

  useEffect(() => {
    let active = true;
    setStatus('Loading cloud data...');
    const fallback = window.setTimeout(() => {
      if (active) {
        setStatus('Cloud delayed. Using local cache.');
      }
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
    () => localItems.map((item) => normalizeItem(item, { scope: 'local', ownerId: user.uid, ownerEmail: user.email })),
    [localItems, user.uid, user.email]
  );
  const cloud = useMemo(() => cloudItems.map((item) => normalizeItem(item, { scope: item.scope })), [cloudItems]);
  const items = useMemo(() => mergeById(local, cloud), [local, cloud]);
  const localUsage = useMemo(() => usageBytes(local), [local]);
  const pendingCount = useMemo(() => local.filter((item) => item.pendingSync).length, [local]);

  const ownerCloudByHash = useMemo(() => {
    const map = new Map();
    for (const item of cloud) {
      if (item.ownerId === user.uid && item.contentHash) map.set(item.contentHash, item);
    }
    return map;
  }, [cloud, user.uid]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === 'pinned' && !item.pinned) return false;
      if (filter === 'archived' && !item.archived) return false;
      if (!['all', 'pinned', 'archived'].includes(filter) && item.contentType !== filter) return false;
      if (!query) return true;
      return normalizeForSearch(item).includes(query);
    });
  }, [items, search, filter]);

  const sections = useMemo(() => buildClipboardSections(filtered, { archiveCollapsed }), [filtered, archiveCollapsed]);
  const sectionTotalCount = useMemo(
    () => Object.values(sections).reduce((sum, sectionItems) => sum + sectionItems.length, 0),
    [sections]
  );

  useEffect(() => {
    setVisibleCount(INITIAL_RENDER_WINDOW);
  }, [search, filter, archiveCollapsed]);

  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return () => {};

    const onScroll = () => {
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 120) {
        setVisibleCount((prev) => Math.min(sectionTotalCount, prev + RENDER_WINDOW_STEP));
      }
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [sectionTotalCount]);

  const stats = useMemo(() => {
    const total = items.length;
    const synced = items.filter((item) => item.scope === 'synced').length;
    const pinned = items.filter((item) => item.pinned).length;
    const frequent = items.filter((item) => (item.usageCount || item.copyCount || 0) > 2).length;
    return { total, synced, pinned, frequent };
  }, [items]);

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

  const buildHashedItem = useCallback(async (item) => {
    const normalized = normalizeItem(item, { scope: item.scope || prefs.captureTarget, ownerId: user.uid, ownerEmail: user.email });
    const text = normalized.kind === 'text' ? normalizeClipboardText(normalized.content) : `${normalized.kind}:${normalized.preview}`;
    const contentHash = normalized.contentHash || (await sha1Text(text));
    return {
      ...normalized,
      content: normalized.kind === 'text' ? text : normalized.content,
      preview: normalized.kind === 'text' ? text.slice(0, 120) : normalized.preview,
      contentHash,
      usageCount: Number(normalized.usageCount || normalized.copyCount || 0),
      copyCount: Number(normalized.copyCount || normalized.usageCount || 0),
      lastCopiedAt: normalized.lastCopiedAt || normalized.updatedAt || new Date().toISOString(),
      contentType: normalized.contentType || detectContentType(normalized)
    };
  }, [prefs.captureTarget, user.uid, user.email]);

  const upsertLocalItem = useCallback(async (item, options = {}) => {
    const hashed = await buildHashedItem(item);
    const nowIso = new Date().toISOString();
    const increment = options.incrementUsage ?? true;

    setLocalItems((arr) => {
      const normalizedArr = arr.map((value) => normalizeItem(value, { scope: 'local', ownerId: user.uid, ownerEmail: user.email }));
      const idx = normalizedArr.findIndex((value) => value.contentHash && value.contentHash === hashed.contentHash);
      if (idx >= 0) {
        const existing = normalizedArr[idx];
        const updated = {
          ...existing,
          ...hashed,
          pendingSync: options.pendingSync ?? existing.pendingSync ?? false,
          lastSyncError: options.lastSyncError ?? '',
          usageCount: increment ? Number(existing.usageCount || existing.copyCount || 0) + 1 : Number(existing.usageCount || existing.copyCount || 0),
          copyCount: increment ? Number(existing.copyCount || existing.usageCount || 0) + 1 : Number(existing.copyCount || existing.usageCount || 0),
          lastCopiedAt: nowIso,
          updatedAt: nowIso
        };
        const next = normalizedArr.filter((_, index) => index !== idx);
        return [updated, ...next];
      }

      const nextItem = {
        ...hashed,
        scope: 'local',
        pendingSync: Boolean(options.pendingSync),
        lastSyncError: options.lastSyncError || '',
        usageCount: increment ? 1 : Number(hashed.usageCount || 0),
        copyCount: increment ? 1 : Number(hashed.copyCount || 0),
        lastCopiedAt: nowIso,
        updatedAt: nowIso
      };
      if (!canStore(normalizedArr, nextItem, prefs.quotaBytes)) throw new Error('Local cache quota reached.');
      return [nextItem, ...normalizedArr];
    });

    return hashed;
  }, [buildHashedItem, prefs.quotaBytes, setLocalItems, user.uid, user.email]);

  const upsertCloudItem = useCallback(async (item, options = {}) => {
    const hashed = await buildHashedItem(item);
    const existing = hashed.contentHash ? ownerCloudByHash.get(hashed.contentHash) : null;
    if (existing) {
      const nextUsage = Number(existing.usageCount || existing.copyCount || 0) + (options.incrementUsage === false ? 0 : 1);
      await updateCloudItem(user, existing.id, {
        content: hashed.content,
        preview: hashed.preview,
        contentType: hashed.contentType,
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

    const id = await createCloudItem(user, {
      ...hashed,
      usageCount: options.incrementUsage === false ? Number(hashed.usageCount || 0) : Math.max(1, Number(hashed.usageCount || 0)),
      copyCount: options.incrementUsage === false ? Number(hashed.copyCount || 0) : Math.max(1, Number(hashed.copyCount || 0)),
      lastCopiedAt: new Date().toISOString(),
      archived: Boolean(hashed.archived)
    }, {
      visibility: prefs.sharingDefaultVisibility
    });
    flashSynced(id);
    return id;
  }, [buildHashedItem, ownerCloudByHash, user, prefs.sharingDefaultVisibility, flashSynced]);

  const syncPendingLocal = useCallback(async ({ manual = false, silent = false } = {}) => {
    if (!user?.uid || syncInFlightRef.current || !isOnline) return { synced: 0, failed: 0 };
    syncInFlightRef.current = true;
    setIsSyncing(true);
    const candidates = local.filter((item) => manual ? !item.archived : item.pendingSync);
    let synced = 0;
    let failed = 0;

    try {
      for (const item of candidates) {
        try {
          await upsertCloudItem({ ...item, scope: 'synced' }, { incrementUsage: false });
          synced += 1;
          setLocalItems((arr) => arr.filter((value) => value.id !== item.id));
        } catch (err) {
          failed += 1;
          setLocalItems((arr) => arr.map((value) => {
            if (value.id !== item.id) return value;
            return { ...value, pendingSync: true, lastSyncError: toMsg(err) };
          }));
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
  }, [local, upsertCloudItem, setLocalItems, user?.uid, isOnline]);

  const runSyncCycle = useCallback(async ({ manual = false, silent = false } = {}) => {
    if (!user?.uid) return;
    if (!manual && !prefs.autoSyncLocal) return;
    try {
      await Promise.race([syncPendingLocal({ manual, silent }), timeout(5000)]);
    } catch {
      if (!silent) setStatus('Sync timeout. Working from local cache.');
    }
  }, [syncPendingLocal, user?.uid, prefs.autoSyncLocal]);

  const captureSnapshot = useCallback(async (snapshot, reason = 'capture') => {
    if (!snapshot?.content) return;
    const candidate = normalizeItem({
      kind: snapshot.kind || 'text',
      content: snapshot.content,
      preview: snapshot.preview || String(snapshot.content).slice(0, 120),
      source: reason,
      scope: prefs.captureTarget,
      visibility: prefs.sharingDefaultVisibility,
      sensitive: snapshot.kind === 'text' && ['email', 'phone'].includes(detectContentType({ content: snapshot.content }))
    }, { scope: prefs.captureTarget, ownerId: user.uid, ownerEmail: user.email });

    const hashed = await buildHashedItem(candidate);
    const now = Date.now();
    if (
      now < suppressCaptureUntilRef.current &&
      hashed.contentHash &&
      hashed.contentHash === suppressCaptureHashRef.current
    ) {
      return;
    }

    if (hashed.contentHash && lastHashRef.current === hashed.contentHash && now - lastCaptureAtRef.current < CAPTURE_REPEAT_GUARD_MS) {
      return;
    }
    lastHashRef.current = hashed.contentHash;
    lastCaptureAtRef.current = now;

    try {
      if (prefs.captureTarget === 'synced' && isOnline) {
        await upsertCloudItem(hashed);
        setStatus('Captured and synced.');
      } else {
        await upsertLocalItem(hashed, { pendingSync: prefs.captureTarget === 'synced', lastSyncError: prefs.captureTarget === 'synced' ? 'Waiting for sync.' : '' });
        setStatus(prefs.captureTarget === 'synced' ? 'Captured locally. Pending sync.' : 'Captured locally.');
      }
      setError('');
      if (prefs.autoSyncLocal || prefs.captureTarget === 'synced') {
        runSyncCycle({ silent: true });
      }
    } catch (err) {
      setError(toMsg(err));
    }
  }, [prefs.captureTarget, prefs.sharingDefaultVisibility, prefs.autoSyncLocal, user.uid, user.email, buildHashedItem, upsertCloudItem, upsertLocalItem, runSyncCycle, isOnline]);

  const scheduleCapture = useCallback((reason = 'event', eventText = '') => {
    if (captureDebounceRef.current) window.clearTimeout(captureDebounceRef.current);
    captureDebounceRef.current = window.setTimeout(async () => {
      const cleanTextValue = normalizeClipboardText(eventText);
      if (cleanTextValue) {
        await captureSnapshot({ kind: 'text', content: cleanTextValue, preview: cleanTextValue.slice(0, 120) }, reason);
        return;
      }
      try {
        const snapshot = await readClipboardSnapshot();
        await captureSnapshot(snapshot, reason);
      } catch (err) {
        if (reason !== 'poll') setError(toMsg(err));
      }
    }, CAPTURE_DEBOUNCE_MS);
  }, [captureSnapshot]);

  useEffect(() => {
    const onCopyCut = (event) => {
      if (!prefs.autoCapture) return;
      const text = event.clipboardData?.getData('text/plain') || '';
      scheduleCapture(event.type, text);
    };
    const onFocus = () => {
      if (prefs.autoCapture) scheduleCapture('focus');
      runSyncCycle({ silent: true });
    };
    const onVisibility = () => {
      if (!document.hidden) {
        if (prefs.autoCapture) scheduleCapture('visible');
        runSyncCycle({ silent: true });
      }
    };
    const onOnline = () => runSyncCycle({ silent: true });

    document.addEventListener('copy', onCopyCut);
    document.addEventListener('cut', onCopyCut);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    runSyncCycle({ silent: true });
    if (prefs.autoCapture) scheduleCapture('load');

    return () => {
      document.removeEventListener('copy', onCopyCut);
      document.removeEventListener('cut', onCopyCut);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [scheduleCapture, runSyncCycle, prefs.autoCapture]);

  useEffect(() => {
    if (!prefs.autoCapture) return;
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(() => {
      if (document.hidden) return;
      scheduleCapture('poll');
    }, Math.max(1500, Number(prefs.pollingMs) || 3000));
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, [prefs.autoCapture, prefs.pollingMs, scheduleCapture]);

  useEffect(() => () => {
    if (captureDebounceRef.current) window.clearTimeout(captureDebounceRef.current);
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    Object.values(longPressTimerRef.current).forEach((timer) => window.clearTimeout(timer));
  }, []);

  const updateItem = useCallback(async (item, patch) => {
    if (item.scope === 'local') {
      setLocalItems((arr) => arr.map((value) => (value.id === item.id ? { ...value, ...patch, updatedAt: new Date().toISOString() } : value)));
      return;
    }
    if (item.ownerId === user.uid) {
      await updateCloudItem(user, item.id, patch);
      flashSynced(item.id);
    }
  }, [setLocalItems, user, flashSynced]);

  const copyItem = useCallback(async (item) => {
    if (item.kind !== 'image') {
      const text = String(item.content || '');
      const hash = await sha1Text(normalizeClipboardText(text));
      suppressCaptureHashRef.current = hash;
      suppressCaptureUntilRef.current = Date.now() + CAPTURE_REPEAT_GUARD_MS;
      await navigator.clipboard.writeText(text);
      const nextUsage = Number(item.usageCount || item.copyCount || 0) + 1;
      await updateItem(item, { usageCount: nextUsage, copyCount: nextUsage, lastCopiedAt: new Date().toISOString() });
    }
  }, [updateItem]);

  const setArchived = useCallback(async (item, archivedValue) => {
    await updateItem(item, { archived: archivedValue });
    setStatus(archivedValue ? 'Item archived.' : 'Item restored.');
  }, [updateItem]);

  const removeItem = useCallback(async (item) => {
    if (item.scope === 'local') {
      setLocalItems((arr) => arr.filter((value) => value.id !== item.id));
      return;
    }
    await deleteCloudItem(item.id);
  }, [setLocalItems]);

  const archiveWithUndo = useCallback(async (item) => {
    await setArchived(item, true);
    setToast({
      text: 'Item archived',
      undo: () => setArchived(item, false)
    });
  }, [setArchived]);

  const deleteWithUndo = useCallback(async (item) => {
    await removeItem(item);
    setToast({
      text: 'Item deleted',
      undo: async () => {
        if (item.scope === 'local') {
          setLocalItems((arr) => [item, ...arr]);
          return;
        }
        await createCloudItem(user, item, { visibility: item.visibility || prefs.sharingDefaultVisibility });
      }
    });
  }, [removeItem, setLocalItems, user, prefs.sharingDefaultVisibility]);

  const onTouchStart = useCallback((item, event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    swipeStartRef.current[item.id] = touch.clientX;
    longPressTriggeredRef.current[item.id] = false;
    if (longPressTimerRef.current[item.id]) window.clearTimeout(longPressTimerRef.current[item.id]);
    longPressTimerRef.current[item.id] = window.setTimeout(() => {
      longPressTriggeredRef.current[item.id] = true;
      setSearchInput(item.preview || String(item.content || '').slice(0, 80));
      setCommandOpen(true);
    }, LONG_PRESS_MS);
  }, []);

  const onTouchMove = useCallback((id, event) => {
    const touch = event.touches?.[0];
    const start = swipeStartRef.current[id];
    if (!touch || typeof start !== 'number') return;
    const delta = touch.clientX - start;
    if (Math.abs(delta) > 12 && longPressTimerRef.current[id]) {
      window.clearTimeout(longPressTimerRef.current[id]);
      delete longPressTimerRef.current[id];
    }
    const limited = Math.max(-110, Math.min(110, delta));
    setSwipeOffsets((prev) => ({ ...prev, [id]: limited }));
  }, []);

  const onTouchEnd = useCallback(async (item) => {
    if (longPressTimerRef.current[item.id]) {
      window.clearTimeout(longPressTimerRef.current[item.id]);
      delete longPressTimerRef.current[item.id];
    }
    if (longPressTriggeredRef.current[item.id]) {
      longPressTriggeredRef.current[item.id] = false;
      ignoreClickUntilRef.current = Date.now() + 350;
      setSwipeOffsets((prev) => ({ ...prev, [item.id]: 0 }));
      delete swipeStartRef.current[item.id];
      return;
    }

    const offset = swipeOffsets[item.id] || 0;
    setSwipeOffsets((prev) => ({ ...prev, [item.id]: 0 }));
    delete swipeStartRef.current[item.id];
    if (offset >= 80) {
      ignoreClickUntilRef.current = Date.now() + 350;
      await deleteWithUndo(item);
    }
    if (offset <= -80) {
      ignoreClickUntilRef.current = Date.now() + 350;
      await archiveWithUndo(item);
    }
  }, [swipeOffsets, archiveWithUndo, deleteWithUndo]);

  const saveManual = useCallback(async () => {
    const text = normalizeClipboardText(manualText);
    if (!text) return;
    await captureSnapshot(createItemFromText(text, 'manual'), 'manual');
    setManualText('');
  }, [manualText, captureSnapshot]);

  async function clearCache() {
    await clearApplicationCaches(user.uid);
    setLocalItems([]);
    setStatus('Local cache cleared.');
  }

  const share = (item) => navigator.clipboard.writeText(buildShareLink(item.id));

  const syncIndicator = (item) => {
    if (item.scope === 'local' && item.pendingSync) return 'sync sync-pending';
    if (item.scope === 'local') return 'sync sync-local';
    if (syncFlash[item.id]) return 'sync sync-ok';
    return 'sync';
  };

  const resultItems = useMemo(() => filtered.slice(0, 30), [filtered]);

  return (
    <div className="layout">
      <Header
        onSignOut={signOutUser}
        onExport={() => {
          const blob = new Blob([JSON.stringify({ localItems, settings: prefs }, null, 2)], { type: 'application/json' });
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
      />

      <section className="status-line" role="status">
        <span>{status}</span>
        {error ? <span className="status-error">{error}</span> : null}
        {!isOnline ? <span className="status-error">Offline</span> : null}
        {pendingCount ? <span className="status-warning">Pending: {pendingCount}</span> : null}
        <span className="status-permission">{isSyncing ? 'syncing...' : 'ready'}</span>
      </section>

      <section className="stats-chips" aria-label="Quick stats">
        <span>TOT {stats.total}</span>
        <span>SYNC {stats.synced}</span>
        <span>PIN {stats.pinned}</span>
        <span>HOT {stats.frequent}</span>
      </section>

      <main className="content">
        <section className="feed">
          <div className="feed-head">
            <h2>Timeline</h2>
            <div className="filters">
              {FILTERS.map((name) => (
                <button key={name} className={filter === name ? 'chip active' : 'chip'} onClick={() => setFilter(name)}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="tools-bar">
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search content, tags, type, date..." />
            <button className="btn" onClick={() => setCommandOpen(true)}>Ctrl+K</button>
          </div>

          <div className="timeline-scroll" ref={timelineRef}>
            {(() => {
              let remaining = visibleCount;
              return Object.entries(sections).map(([section, sectionItems]) => {
                if (remaining <= 0) return null;
                const visibleItems = sectionItems.slice(0, remaining);
                remaining -= visibleItems.length;

                return (
                  <div key={section} className="timeline-section">
                    <h3 className="timeline-label">
                      {section} {section === 'ARCHIVE' ? <button className="mini-action" onClick={() => setArchiveCollapsed((value) => !value)}>{archiveCollapsed ? 'Expand' : 'Collapse'}</button> : null}
                    </h3>
                    {visibleItems.length === 0 ? null : visibleItems.map((item) => (
                      <article
                        key={item.id}
                        className="entry touch-entry"
                        style={{ transform: `translateX(${swipeOffsets[item.id] || 0}px)` }}
                        onTouchStart={(event) => onTouchStart(item, event)}
                        onTouchMove={(event) => onTouchMove(item.id, event)}
                        onTouchEnd={() => onTouchEnd(item)}
                        onTouchCancel={() => onTouchEnd(item)}
                        onClick={() => {
                          if (Date.now() < ignoreClickUntilRef.current) return;
                          copyItem(item);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setCommandOpen(true);
                          setSearchInput(item.preview || '');
                        }}
                      >
                        <div className="entry-head">
                          <div>
                            <div className="entry-badges">
                              <span className={syncIndicator(item)} aria-label="Sync status" />
                              <span className="entry-kind">{itemIcon(item)} {item.contentType}</span>
                              {item.pinned ? <span className="scope-pill">pinned</span> : null}
                              {item.archived ? <span className="scope-pill">archived</span> : null}
                            </div>
                            <h3>{item.details?.title || item.preview || 'Clipboard entry'}</h3>
                            <p className="entry-meta">{new Date(item.updatedAt || item.createdAt).toLocaleString()} | used {item.usageCount || item.copyCount || 0}x</p>
                          </div>
                        </div>

                        <div className={`entry-preview ${prefs.blurSensitive && item.sensitive ? 'blur-sensitive' : ''}`}>
                          {prefs.hidePreviews ? <div className="preview-muted">Preview hidden</div> : item.kind === 'image' ? <img className="entry-image" src={item.content} alt="Clipboard image" loading="lazy" /> : <pre>{item.contentType === 'json' || item.contentType === 'code' ? cleanText(item.content) : item.content}</pre>}
                        </div>

                        <div className="entry-foot">
                          <button className="mini-action" onClick={(event) => { event.stopPropagation(); copyItem(item); }}>Copy</button>
                          <button className="mini-action" onClick={(event) => { event.stopPropagation(); updateItem(item, { pinned: !item.pinned }); }}>{item.pinned ? 'Unpin' : 'Pin'}</button>
                          <button className="mini-action" onClick={(event) => { event.stopPropagation(); archiveWithUndo(item); }}>Archive</button>
                          <button className="mini-action" onClick={(event) => { event.stopPropagation(); deleteWithUndo(item); }}>Delete</button>
                          <button className="mini-action" onClick={(event) => { event.stopPropagation(); share(item); }}>Share</button>
                        </div>
                      </article>
                    ))}
                  </div>
                );
              });
            })()}
            {visibleCount < sectionTotalCount ? (
              <button className="btn" onClick={() => setVisibleCount((prev) => Math.min(sectionTotalCount, prev + RENDER_WINDOW_STEP))}>
                Load more
              </button>
            ) : null}
          </div>
        </section>

        <aside className={settingsOpen ? 'panel settings-panel is-open' : 'panel settings-panel'}>
          <button className="btn close-settings" onClick={() => setSettingsOpen(false)}>Close</button>
          <h3>Settings</h3>

          <div className="panel-block">
            <h4>ACCOUNT</h4>
            <p>{profile?.displayName || user?.displayName || 'User'}</p>
            <p>{profile?.email || user?.email || '-'}</p>
            <label className="switch">
              <input type="checkbox" checked={keepSignedIn} onChange={(event) => setKeepSignedIn(event.target.checked)} />
              Keep signed in
            </label>
          </div>

          <div className="panel-block">
            <h4>SYNC</h4>
            <p>Local usage: {formatBytes(localUsage)}</p>
            <p>Cloud items: {cloud.length}</p>
            <button className="btn" disabled={!isOnline || isSyncing} onClick={() => runSyncCycle({ manual: true })}>
              {isSyncing ? 'Syncing...' : 'Manual sync'}
            </button>
            <label className="switch">
              <input type="checkbox" checked={prefs.autoSyncLocal} onChange={(event) => setSettings((prev) => ({ ...prev, autoSyncLocal: event.target.checked }))} />
              Auto-sync pending local
            </label>
          </div>

          <div className="panel-block">
            <h4>CAPTURE</h4>
            <label className="switch">
              <input type="checkbox" checked={prefs.autoCapture} onChange={(event) => setSettings((prev) => ({ ...prev, autoCapture: event.target.checked }))} />
              Auto capture
            </label>
            <label className="range-row">
              Interval: {Math.round(prefs.pollingMs / 1000)}s
              <input type="range" min="2000" max="10000" step="500" value={prefs.pollingMs} onChange={(event) => setSettings((prev) => ({ ...prev, pollingMs: Number(event.target.value) }))} />
            </label>
            <label>
              Capture target
              <select value={prefs.captureTarget} onChange={(event) => setSettings((prev) => ({ ...prev, captureTarget: event.target.value }))}>
                <option value="synced">Synced</option>
                <option value="local">Local only</option>
              </select>
            </label>
            <textarea value={manualText} onChange={(event) => setManualText(event.target.value)} placeholder="Manual clipboard input..." />
            <button className="btn-strong" onClick={saveManual}>Save manual text</button>
          </div>

          <div className="panel-block">
            <h4>DISPLAY</h4>
            <label>
              Theme
              <select value={prefs.theme} onChange={(event) => setSettings((prev) => ({ ...prev, theme: event.target.value }))}>
                {THEMES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="switch">
              <input type="checkbox" checked={prefs.blurSensitive} onChange={(event) => setSettings((prev) => ({ ...prev, blurSensitive: event.target.checked }))} />
              Blur sensitive content
            </label>
            <label className="switch">
              <input type="checkbox" checked={prefs.hidePreviews} onChange={(event) => setSettings((prev) => ({ ...prev, hidePreviews: event.target.checked }))} />
              Hide previews
            </label>
          </div>

          <div className="panel-block settings-footer">
            <h4>v1.3.0</h4>
            <div className="settings-links">
              <button className="btn" onClick={clearCache}>Clear local cache</button>
              <a className="btn" href="https://github.com/antoleod/clipboard" target="_blank" rel="noreferrer">Help</a>
              <a className="btn" href="https://oryxen.tech/privacy" target="_blank" rel="noreferrer">Privacy</a>
            </div>
          </div>
        </aside>
      </main>

      {commandOpen ? (
        <div className="modal-backdrop" onClick={() => setCommandOpen(false)}>
          <div className="command-palette" onClick={(event) => event.stopPropagation()}>
            <h3>Quick search</h3>
            <input autoFocus value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search by content, tags, type, date..." />
            <ul>
              {resultItems.map((item) => (
                <li key={item.id}>
                  <button onClick={() => { copyItem(item); setCommandOpen(false); }}>
                    {itemIcon(item)} {item.preview || item.content.slice(0, 80)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="toast">
          <span>{toast.text}</span>
          <button className="mini-action" onClick={() => { toast.undo?.(); setToast(null); }}>Undo</button>
          <button className="mini-action" onClick={() => setToast(null)}>Close</button>
        </div>
      ) : null}
    </div>
  );
}
