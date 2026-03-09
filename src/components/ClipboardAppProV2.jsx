import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './Header';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useClipboardPermission } from '../hooks/useClipboardPermission';
import { useClipboardSync } from '../hooks/useClipboardSync';
import { readClipboardSnapshot } from '../services/clipboard';
import {
  signOutUser,
  loadUserPreferences,
  saveUserPreferences
} from '../services/authService';
import { clearApplicationCaches } from '../services/cacheService';
import { buildShareLink } from '../services/cloudClipboardService';
import { SYNC_STATES } from '../services/clipboardSyncService';
import {
  detectContentType,
  computeSensitive,
  getDomain
} from '../features/clipboard/contentIntelligence';
import { buildClipboardSections } from '../features/clipboard/sections';
import { cleanText } from '../features/clipboard/textTools';
import { createItemFromText } from '../features/clipboard/model';
import {
  DEFAULT_USER_PREFERENCES,
  mergeUserPreferences,
  normalizeUserPreferences
} from '../features/preferences/userPreferences';
import { THEME_OPTIONS } from '../features/theme/themeSystem';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'error', label: 'Errors' },
  { id: 'text', label: 'Text' },
  { id: 'url', label: 'Links' },
  { id: 'code', label: 'Code' },
  { id: 'image', label: 'Images' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'archived', label: 'Archived' }
];

function buildItemFromSnapshot(snapshot, user) {
  const contentType = detectContentType(snapshot);
  return {
    ...snapshot,
    ownerId: user.uid,
    ownerEmail: user.email || '',
    contentType,
    sensitive: computeSensitive({ ...snapshot, contentType })
  };
}

function matchesFilter(item, filter) {
  if (filter === 'all') return true;
  if (filter === 'pending') return item.syncState === SYNC_STATES.PENDING || item.syncState === SYNC_STATES.SYNCING;
  if (filter === 'error') return item.syncState === SYNC_STATES.ERROR;
  if (filter === 'pinned') return Boolean(item.pinned);
  if (filter === 'archived') return Boolean(item.archived);
  return item.contentType === filter;
}

function syncStateLabel(syncState) {
  switch (syncState) {
    case SYNC_STATES.LOCAL:
      return 'Local only';
    case SYNC_STATES.PENDING:
      return 'Pending sync';
    case SYNC_STATES.SYNCING:
      return 'Syncing';
    case SYNC_STATES.ERROR:
      return 'Sync error';
    default:
      return 'Synced';
  }
}

function statusTone(syncState) {
  switch (syncState) {
    case SYNC_STATES.LOCAL:
      return 'local-only';
    case SYNC_STATES.PENDING:
      return 'pending-sync';
    case SYNC_STATES.SYNCING:
      return 'syncing';
    case SYNC_STATES.ERROR:
      return 'sync-error';
    default:
      return 'synced';
  }
}

export default function ClipboardAppProV2() {
  const { user, profile, keepSignedIn, setKeepSignedIn } = useAuth();
  const [settingsCache, setSettingsCache] = useLocalStorage(
    'clipboard-vault-settings',
    DEFAULT_USER_PREFERENCES
  );
  const [preferences, setPreferences] = useState(() =>
    mergeUserPreferences(DEFAULT_USER_PREFERENCES, settingsCache || {})
  );
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [footerPanel, setFooterPanel] = useState('sync');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState('all');
  const [manualText, setManualText] = useState('');
  const [status, setStatus] = useState('Ready.');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [archiveCollapsed, setArchiveCollapsed] = useState(true);
  const pollTimerRef = useRef(null);

  const {
    permissionState,
    permissionCopy,
    canReadClipboard,
    requestPermission,
    refreshPermission
  } = useClipboardPermission();

  const search = useDebouncedValue(searchInput, 220);
  const effectivePreferences = useMemo(
    () => normalizeUserPreferences({ ...preferences, keepSignedIn }),
    [keepSignedIn, preferences]
  );
  const debouncedPreferences = useDebouncedValue(effectivePreferences, 350);

  const {
    items,
    diagnostics,
    isOnline,
    isSyncing,
    isHydrated,
    pendingCount,
    syncMeta,
    saveItem,
    updateItem,
    deleteItem,
    retryFailed,
    flushOutbox
  } = useClipboardSync(user, { autoSyncPending: effectivePreferences.autoSyncPending });

  useTheme(
    effectivePreferences.themeId,
    effectivePreferences.themeMode,
    effectivePreferences.customThemeOverrides
  );

  const updatePreferences = useCallback((nextValue) => {
    setPreferences((prev) => {
      const candidate =
        typeof nextValue === 'function' ? nextValue(prev) : { ...prev, ...nextValue };
      return normalizeUserPreferences(candidate);
    });
  }, []);

  useEffect(() => {
    let active = true;
    const localBaseline = mergeUserPreferences(DEFAULT_USER_PREFERENCES, settingsCache || {});

    Promise.resolve().then(() => {
      if (!active) return;
      setPreferences(localBaseline);
      setPreferencesReady(false);
    });

    loadUserPreferences(user.uid)
      .then((remotePreferences) => {
        if (!active) return;
        const merged = mergeUserPreferences(localBaseline, remotePreferences || {});
        setPreferences(merged);
        setSettingsCache(merged);
        setFilter(merged.activeFilters?.[0] || 'all');
      })
      .catch(() => {
        if (active) {
          setError('Preferences cloud sync unavailable. Using local settings.');
        }
      })
      .finally(() => {
        if (active) setPreferencesReady(true);
      });

    return () => {
      active = false;
    };
  }, [setSettingsCache, settingsCache, user.uid]);

  useEffect(() => {
    if (!preferencesReady || !user.uid) return;
    setSettingsCache(debouncedPreferences);
    saveUserPreferences(user.uid, debouncedPreferences).catch((saveError) => {
      setError(saveError instanceof Error ? saveError.message : 'Could not save preferences.');
    });
  }, [debouncedPreferences, preferencesReady, setSettingsCache, user.uid]);

  useEffect(() => {
    refreshPermission();
  }, [refreshPermission]);

  const syncSummary = useMemo(() => {
    if (!isOnline) return 'Offline. Local cache active.';
    if (isSyncing) return `Syncing ${pendingCount} pending items...`;
    if (syncMeta.lastError) return 'Cloud degraded. Retrying pending changes.';
    if (pendingCount > 0) return `${pendingCount} pending changes.`;
    return 'Cloud synced.';
  }, [isOnline, isSyncing, pendingCount, syncMeta.lastError]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => matchesFilter(item, filter))
      .filter((item) => {
        if (!query) return true;
        return [
          item.preview,
          item.content,
          item.contentType,
          item.ownerEmail,
          item.lastSyncError
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
  }, [filter, items, search]);

  const sections = useMemo(
    () => buildClipboardSections(filteredItems, { archiveCollapsed }),
    [archiveCollapsed, filteredItems]
  );

  const stats = useMemo(
    () => ({
      total: items.length,
      synced: items.filter((item) => item.syncState === SYNC_STATES.SYNCED).length,
      pending: items.filter((item) => item.syncState === SYNC_STATES.PENDING || item.syncState === SYNC_STATES.SYNCING).length,
      local: items.filter((item) => item.syncState === SYNC_STATES.LOCAL).length,
      errors: items.filter((item) => item.syncState === SYNC_STATES.ERROR).length
    }),
    [items]
  );

  const captureSnapshot = useCallback(
    async (snapshot, reason) => {
      const item = buildItemFromSnapshot(snapshot, user);
      await saveItem(item);
      setStatus(reason === 'manual' ? 'Manual note saved.' : 'Clipboard captured.');
      setError('');
    },
    [saveItem, user]
  );

  const captureClipboard = useCallback(
    async (reason = 'manual') => {
      try {
        const snapshot = await readClipboardSnapshot();
        await captureSnapshot(snapshot, reason);
      } catch (captureError) {
        setError(captureError instanceof Error ? captureError.message : 'Clipboard capture failed.');
      }
    },
    [captureSnapshot]
  );

  const saveManual = useCallback(async () => {
    const text = manualText.trim();
    if (!text) return;
    await captureSnapshot(createItemFromText(text, 'manual-entry'), 'manual');
    setManualText('');
  }, [captureSnapshot, manualText]);

  useEffect(() => {
    if (!effectivePreferences.autoCapture || !canReadClipboard) return;
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(() => {
      if (!document.hidden) {
        captureClipboard('poll');
      }
    }, effectivePreferences.captureIntervalSec * 1000);

    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, [canReadClipboard, captureClipboard, effectivePreferences.autoCapture, effectivePreferences.captureIntervalSec]);

  useEffect(
    () => () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    },
    []
  );

  const copyItem = useCallback(
    async (item) => {
      if (item.kind === 'image') return;
      await navigator.clipboard.writeText(String(item.content || ''));
      await updateItem(item, {
        copyCount: Number(item.copyCount || item.usageCount || 0) + 1,
        usageCount: Number(item.copyCount || item.usageCount || 0) + 1,
        lastCopiedAt: new Date().toISOString()
      });
      setToast('Copied to clipboard.');
      window.setTimeout(() => setToast(''), 1800);
    },
    [updateItem]
  );

  const exportData = useCallback(() => {
    const data = JSON.stringify({ preferences: effectivePreferences, diagnostics, items }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'clipboard-export.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }, [diagnostics, effectivePreferences, items]);

  const clearCache = useCallback(async () => {
    await clearApplicationCaches(user.uid);
    window.location.reload();
  }, [user.uid]);

  const copyDiagnostics = useCallback(async () => {
    const payload = JSON.stringify(diagnostics, null, 2);
    await navigator.clipboard.writeText(payload);
    setToast('Diagnostics copied.');
    window.setTimeout(() => setToast(''), 1800);
  }, [diagnostics]);

  return (
    <div className={effectivePreferences.compactMode ? 'layout density-compact' : 'layout density-comfortable'}>
      <Header
        onSignOut={signOutUser}
        onExport={exportData}
        onToggleSettings={() => setSettingsOpen((value) => !value)}
        user={user}
        profile={profile}
        syncSummary={syncSummary}
        isOnline={isOnline}
      />

      <section className='status-line' role='status' aria-live='polite'>
        <div className='status-main'>
          <strong>{syncSummary}</strong>
          <span>{isHydrated ? status : 'Hydrating workspace...'}</span>
          {error ? <span className='status-error'>{error}</span> : null}
          {syncMeta.lastError ? <span className='status-error'>{syncMeta.lastError}</span> : null}
        </div>
        <div className='status-right'>
          {!isOnline ? <span className='status-badge danger'>Offline fallback</span> : null}
          {pendingCount ? <span className='status-badge warning'>Pending {pendingCount}</span> : null}
          <span className='status-badge neutral'>Listener {diagnostics.listenerState}</span>
          <span className='status-badge neutral'>Permission {permissionState}</span>
        </div>
      </section>

      {effectivePreferences.autoCapture && permissionState !== 'granted' ? (
        <section className='permission-banner' role='alert'>
          <div>
            <strong>{permissionCopy.title}</strong>
            <p>{permissionCopy.help}</p>
          </div>
          <div className='permission-actions'>
            <button className='btn-strong' onClick={requestPermission}>Enable access</button>
            <button className='btn' onClick={refreshPermission}>Retry</button>
          </div>
        </section>
      ) : null}

      <section className='stats-chips'>
        <span>TOTAL {stats.total}</span>
        <span>SYNCED {stats.synced}</span>
        <span>PENDING {stats.pending}</span>
        <span>LOCAL {stats.local}</span>
        <span>ERRORS {stats.errors}</span>
      </section>

      <main className='content app-grid'>
        <section className='feed panel-surface'>
          <div className='feed-head'>
            <h2>Timeline</h2>
            <div className='filters'>
              {FILTERS.map((entry) => (
                <button
                  key={entry.id}
                  className={filter === entry.id ? 'chip active' : 'chip'}
                  onClick={() => {
                    setFilter(entry.id);
                    updatePreferences({ activeFilters: [entry.id] });
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className='tools-bar'>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder='Search content, owner, errors or type...'
            />
            <button className='btn' onClick={() => setDiagnosticsOpen((value) => !value)}>
              {diagnosticsOpen ? 'Hide debug' : 'Show debug'}
            </button>
          </div>

          <div className='capture-row'>
            <textarea
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              placeholder='Paste or type a note manually...'
            />
            <div className='capture-actions'>
              <button className='btn-strong' onClick={saveManual}>Save note</button>
              <button className='btn' onClick={() => captureClipboard('clipboard-read')}>Capture clipboard</button>
            </div>
          </div>

          {diagnosticsOpen ? (
            <section className='diagnostics-panel'>
              <div className='diagnostics-head'>
                <h3>Diagnostics</h3>
                <button className='btn' onClick={copyDiagnostics}>Copy</button>
              </div>
              <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
            </section>
          ) : null}

          <div className='timeline-scroll'>
            {filteredItems.length === 0 ? (
              <div className='empty-state'>
                <h3>No items yet</h3>
                <p>Cloud and local cache are ready. Capture something to populate the timeline.</p>
              </div>
            ) : (
              Object.entries(sections).map(([section, sectionItems]) => {
                if (!sectionItems.length) return null;
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

                    {sectionItems.map((item) => (
                      <article key={item.id} className={`entry type-${item.contentType}${item.pinned ? ' is-pinned' : ''}`}>
                        <div className='entry-head'>
                          <div>
                            <div className='entry-badges'>
                              <span className={`sync-dot sync-${statusTone(item.syncState)}`} />
                              <span className='entry-kind'>{item.contentType}</span>
                              <span className='scope-pill'>{syncStateLabel(item.syncState)}</span>
                              {item.pinned ? <span className='scope-pill'>Pinned</span> : null}
                              {item.archived ? <span className='scope-pill'>Archived</span> : null}
                            </div>
                            <h3>{item.preview || 'Clipboard entry'}</h3>
                            <p className='entry-meta'>
                              {new Date(item.updatedAt || item.createdAt).toLocaleString()} | {item.ownerEmail || 'local'} | {item.scope}
                            </p>
                          </div>
                        </div>

                        <div className={effectivePreferences.blurSensitiveContent && item.sensitive ? 'entry-preview blur-sensitive' : 'entry-preview'}>
                          {effectivePreferences.hidePreviews ? <div className='preview-muted'>Preview hidden</div> : null}
                          {!effectivePreferences.hidePreviews && item.kind === 'image' ? (
                            <img className='entry-image' src={item.content} alt='Clipboard capture' loading='lazy' />
                          ) : null}
                          {!effectivePreferences.hidePreviews && item.kind !== 'image' && item.contentType === 'url' ? (
                            <div className='url-preview'>
                              <strong>{getDomain(String(item.content || '')) || 'Link'}</strong>
                              <a href={String(item.content)} target='_blank' rel='noreferrer'>
                                {String(item.content)}
                              </a>
                            </div>
                          ) : null}
                          {!effectivePreferences.hidePreviews && item.kind !== 'image' && item.contentType !== 'url' ? (
                            <pre>{item.contentType === 'code' ? cleanText(item.content) : String(item.content || '')}</pre>
                          ) : null}
                        </div>

                        {item.lastSyncError ? <p className='item-error'>{item.lastSyncError}</p> : null}

                        <div className='entry-foot'>
                          <button className='mini-action' onClick={() => copyItem(item)}>Copy</button>
                          <button className='mini-action' onClick={() => updateItem(item, { pinned: !item.pinned })}>
                            {item.pinned ? 'Unpin' : 'Pin'}
                          </button>
                          <button className='mini-action' onClick={() => updateItem(item, { archived: !item.archived })}>
                            {item.archived ? 'Restore' : 'Archive'}
                          </button>
                          {item.syncState === SYNC_STATES.ERROR ? (
                            <button className='mini-action' onClick={retryFailed}>Retry</button>
                          ) : null}
                          {item.scope !== 'local' ? (
                            <button
                              className='mini-action'
                              onClick={() => navigator.clipboard.writeText(buildShareLink(item.id))}
                            >
                              Share
                            </button>
                          ) : null}
                          <button className='mini-action' onClick={() => deleteItem(item)}>Delete</button>
                        </div>
                      </article>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <aside className={settingsOpen ? 'panel-surface settings-panel is-open' : 'panel-surface settings-panel'}>
          <div className='settings-head'>
            <h3>Settings</h3>
            <button className='btn close-settings' onClick={() => setSettingsOpen(false)}>Close</button>
          </div>

          <div className='panel-block'>
            <h4>Theme</h4>
            <label>
              Palette
              <select value={effectivePreferences.themeId} onChange={(event) => updatePreferences({ themeId: event.target.value })}>
                {THEME_OPTIONS.map((theme) => (
                  <option key={theme.id} value={theme.id}>{theme.label}</option>
                ))}
              </select>
            </label>
            <label>
              Mode
              <select value={effectivePreferences.themeMode} onChange={(event) => updatePreferences({ themeMode: event.target.value })}>
                <option value='dark'>Dark</option>
                <option value='light'>Light</option>
              </select>
            </label>
          </div>

          <div className='panel-block'>
            <h4>Capture</h4>
            <label className='switch'>
              <input
                type='checkbox'
                checked={effectivePreferences.autoCapture}
                onChange={(event) => updatePreferences({ autoCapture: event.target.checked })}
              />
              Auto capture clipboard
            </label>
            <label className='switch'>
              <input
                type='checkbox'
                checked={effectivePreferences.autoSyncPending}
                onChange={(event) => updatePreferences({ autoSyncPending: event.target.checked })}
              />
              Auto retry pending changes
            </label>
            <label>
              Poll interval
              <select
                value={effectivePreferences.captureIntervalSec}
                onChange={(event) => updatePreferences({ captureIntervalSec: Number(event.target.value) })}
              >
                <option value='2'>2 sec</option>
                <option value='3'>3 sec</option>
                <option value='5'>5 sec</option>
                <option value='10'>10 sec</option>
              </select>
            </label>
          </div>

          <div className='panel-block'>
            <h4>Display</h4>
            <label className='switch'>
              <input
                type='checkbox'
                checked={effectivePreferences.compactMode}
                onChange={(event) => updatePreferences({ compactMode: event.target.checked })}
              />
              Compact layout
            </label>
            <label className='switch'>
              <input
                type='checkbox'
                checked={effectivePreferences.hidePreviews}
                onChange={(event) => updatePreferences({ hidePreviews: event.target.checked })}
              />
              Hide previews
            </label>
            <label className='switch'>
              <input
                type='checkbox'
                checked={effectivePreferences.blurSensitiveContent}
                onChange={(event) => updatePreferences({ blurSensitiveContent: event.target.checked })}
              />
              Blur sensitive content
            </label>
          </div>
        </aside>

        <footer className='footer-fixed panel-surface'>
          <div className='footer-actions'>
            <button className={footerPanel === 'sync' ? 'btn active' : 'btn'} onClick={() => setFooterPanel('sync')}>Sync</button>
            <button className={footerPanel === 'display' ? 'btn active' : 'btn'} onClick={() => setFooterPanel('display')}>Display</button>
            <button className={footerPanel === 'account' ? 'btn active' : 'btn'} onClick={() => setFooterPanel('account')}>Account</button>
            <button className='btn-strong' onClick={() => flushOutbox('footer-force')} disabled={!isOnline || isSyncing}>
              {isSyncing ? 'Syncing...' : 'Force sync'}
            </button>
          </div>

          {footerPanel === 'sync' ? (
            <div className='footer-panel'>
              <div className='panel-block footer-grid'>
                <div>
                  <h4>Sync state</h4>
                  <p>{syncSummary}</p>
                  <p>Last sync: {diagnostics.lastSyncAt || 'Not yet'}</p>
                </div>
                <div>
                  <h4>Cloud status</h4>
                  <p>Listener: {diagnostics.listenerState}</p>
                  <p>Backend: {diagnostics.backendState}</p>
                </div>
              </div>
            </div>
          ) : null}

          {footerPanel === 'display' ? (
            <div className='footer-panel'>
              <div className='panel-block footer-grid'>
                <div>
                  <h4>Theme</h4>
                  <p>{effectivePreferences.themeId}</p>
                </div>
                <div>
                  <h4>Layout</h4>
                  <p>{effectivePreferences.compactMode ? 'Compact' : 'Comfortable'}</p>
                </div>
              </div>
            </div>
          ) : null}

          {footerPanel === 'account' ? (
            <div className='footer-panel'>
              <div className='panel-block footer-grid'>
                <div>
                  <h4>Account</h4>
                  <p>{profile?.displayName || user.displayName || 'User'}</p>
                  <p>{profile?.email || user.email || '-'}</p>
                  <label className='switch'>
                    <input
                      type='checkbox'
                      checked={keepSignedIn}
                      onChange={(event) => setKeepSignedIn(event.target.checked)}
                    />
                    Keep signed in
                  </label>
                </div>
                <div className='footer-account-actions'>
                  <button className='btn' onClick={clearCache}>Clear local cache</button>
                  <button className='btn' onClick={() => setSettingsOpen(true)}>Open settings</button>
                </div>
              </div>
            </div>
          ) : null}
        </footer>
      </main>

      {toast ? <div className='toast'><span>{toast}</span></div> : null}
    </div>
  );
}
