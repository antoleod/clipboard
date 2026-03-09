import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Header } from './Header';
import {
  IconChevron,
  IconCloud,
  IconCopy,
  IconDisplay,
  IconPin,
  IconSettings,
  IconSync,
  IconUser
} from './Icons';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useClipboardPermission } from '../hooks/useClipboardPermission';
import { useClipboardSync } from '../hooks/useClipboardSync';
import { readClipboardSnapshot } from '../services/clipboard';
import { debugLog, debugWarn, isDebugLoggingEnabled } from '../services/debugLogger';
import { signOutUser, loadUserPreferences, saveUserPreferences } from '../services/authService';
import { clearApplicationCaches } from '../services/cacheService';
import { SYNC_STATES } from '../services/clipboardSyncService';
import { detectContentType, computeSensitive, getDomain } from '../features/clipboard/contentIntelligence';
import { buildClipboardSections } from '../features/clipboard/sections';
import { cleanText } from '../features/clipboard/textTools';
import { createItemFromText, normalizeItem } from '../features/clipboard/model';
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
  { id: 'image', label: 'Images' }
];

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'sync', label: 'Sync' },
  { id: 'display', label: 'Display' },
  { id: 'privacy', label: 'Privacy' }
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
  return item.contentType === filter;
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

function statusCopy(isOnline, isSyncing, pendingCount, syncError) {
  if (!isOnline) return { label: 'Offline', tone: 'offline' };
  if (isSyncing || pendingCount > 0) return { label: 'Syncing', tone: 'syncing' };
  if (syncError) return { label: 'Issue', tone: 'error' };
  return { label: 'Synced', tone: 'synced' };
}

function iconLabelForItem(item) {
  if (item.contentType === 'url') return 'LINK';
  if (item.contentType === 'code') return 'CODE';
  if (item.contentType === 'image') return 'IMG';
  return 'TEXT';
}

export default function ClipboardAppProV2() {
  const { user, profile, keepSignedIn, setKeepSignedIn } = useAuth();
  const [settingsCache, setSettingsCache] = useLocalStorage('clipboard-vault-settings', DEFAULT_USER_PREFERENCES);
  const [preferences, setPreferences] = useState(() => mergeUserPreferences(DEFAULT_USER_PREFERENCES, settingsCache || {}));
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [filter, setFilter] = useState('all');
  const [manualText, setManualText] = useState('');
  const [toast, setToast] = useState('');
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [archiveCollapsed, setArchiveCollapsed] = useState(true);
  const [preferencesNotice, setPreferencesNotice] = useState('');
  const [settingsSections, setSettingsSections] = useState({
    general: true,
    sync: true,
    display: true,
    privacy: false
  });
  const pollTimerRef = useRef(null);
  const lastCapturedHashRef = useRef('');

  const search = useDebouncedValue(searchInput, 220);
  const effectivePreferences = useMemo(
    () => normalizeUserPreferences({ ...preferences, keepSignedIn }),
    [keepSignedIn, preferences]
  );
  const debouncedPreferences = useDebouncedValue(effectivePreferences, 350);

  const {
    permissionState,
    permissionCopy,
    canReadClipboard,
    markPermissionGranted,
    requestPermission,
    refreshPermission
  } = useClipboardPermission();

  const {
    items,
    diagnostics,
    isOnline,
    isSyncing,
    pendingCount,
    syncMeta,
    saveItem,
    updateItem,
    flushOutbox
  } = useClipboardSync(user, { autoSyncPending: effectivePreferences.autoSyncPending });

  useTheme(effectivePreferences.themeId, effectivePreferences.themeMode, effectivePreferences.customThemeOverrides);

  const updatePreferences = useCallback((nextValue) => {
    setPreferences((prev) => {
      const candidate = typeof nextValue === 'function' ? nextValue(prev) : { ...prev, ...nextValue };
      return normalizeUserPreferences(candidate);
    });
  }, []);

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
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
          setPreferencesNotice('Cloud preferences unavailable. Using local settings.');
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
    saveUserPreferences(user.uid, debouncedPreferences).catch(() => {
      setPreferencesNotice('Cloud preferences unavailable. Changes stay local on this device.');
    });
  }, [debouncedPreferences, preferencesReady, setSettingsCache, user.uid]);

  useEffect(() => {
    refreshPermission();
  }, [refreshPermission]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items
      .filter((item) => matchesFilter(item, filter))
      .filter((item) => {
        if (!query) return true;
        return [item.preview, item.content, item.contentType, item.ownerEmail, item.lastSyncError]
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

  const syncBadge = useMemo(
    () => statusCopy(isOnline, isSyncing, pendingCount, syncMeta.lastError),
    [isOnline, isSyncing, pendingCount, syncMeta.lastError]
  );

  const captureSnapshot = useCallback(
    async (snapshot) => {
      const item = normalizeItem(buildItemFromSnapshot(snapshot, user));
      if (item.contentHash && item.contentHash === lastCapturedHashRef.current) {
        debugLog('capture', 'Skipped duplicate clipboard snapshot', {
          itemId: item.id,
          contentHash: item.contentHash
        });
        return false;
      }
      debugLog('capture', 'Saving clipboard snapshot', {
        itemId: item.id,
        contentType: item.contentType,
        source: item.source
      });
      await saveItem(item);
      lastCapturedHashRef.current = item.contentHash || '';
      markPermissionGranted();
      return true;
    },
    [markPermissionGranted, saveItem, user]
  );

  const captureClipboard = useCallback(async () => {
    try {
      debugLog('capture', 'Capture requested');
      const snapshot = await readClipboardSnapshot();
      const captured = await captureSnapshot(snapshot);
      if (captured) {
        showToast('Clipboard captured.');
      }
    } catch (captureError) {
      debugWarn('capture', 'Capture failed', {
        message: captureError instanceof Error ? captureError.message : 'Unknown capture failure'
      });
      showToast(captureError instanceof Error ? captureError.message : 'Clipboard capture failed.');
    }
  }, [captureSnapshot, showToast]);

  const saveManual = useCallback(async () => {
    const text = manualText.trim();
    if (!text) return;
    await captureSnapshot(createItemFromText(text, 'manual-entry'));
    setManualText('');
    showToast('Note saved.');
  }, [captureSnapshot, manualText, showToast]);

  useEffect(() => {
    if (!effectivePreferences.autoCapture) {
      debugLog('capture', 'Auto capture disabled by preference');
      return;
    }
    if (!canReadClipboard) {
      debugLog('capture', 'Auto capture waiting for permission', { permissionState });
      return;
    }
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    debugLog('capture', 'Starting auto capture polling', {
      intervalSec: effectivePreferences.captureIntervalSec,
      permissionState
    });
    if (!document.hidden) {
      debugLog('capture', 'Triggering immediate capture at startup');
      window.setTimeout(() => {
        captureClipboard();
      }, 0);
    }
    pollTimerRef.current = window.setInterval(() => {
      if (!document.hidden) {
        debugLog('capture', 'Auto capture poll tick');
        captureClipboard();
      } else {
        debugLog('capture', 'Auto capture poll skipped: document hidden');
      }
    }, effectivePreferences.captureIntervalSec * 1000);

    return () => {
      debugLog('capture', 'Stopping auto capture polling');
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    };
  }, [canReadClipboard, captureClipboard, effectivePreferences.autoCapture, effectivePreferences.captureIntervalSec, permissionState]);

  useEffect(() => {
    if (!effectivePreferences.autoCapture || !canReadClipboard) return;

    const onClipboardEvent = (event) => {
      debugLog('capture', 'Clipboard event detected, forcing immediate capture', {
        type: event.type
      });
      captureClipboard();
    };

    document.addEventListener('copy', onClipboardEvent);
    document.addEventListener('cut', onClipboardEvent);

    return () => {
      document.removeEventListener('copy', onClipboardEvent);
      document.removeEventListener('cut', onClipboardEvent);
    };
  }, [canReadClipboard, captureClipboard, effectivePreferences.autoCapture]);

  useEffect(() => {
    if (!effectivePreferences.autoCapture || !canReadClipboard) return;

    const onVisibilityChange = () => {
      if (!document.hidden) {
        debugLog('capture', 'Visibility restored, attempting capture');
        captureClipboard();
      }
    };

    const onFocus = () => {
      debugLog('capture', 'Window focus, attempting capture');
      captureClipboard();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [canReadClipboard, captureClipboard, effectivePreferences.autoCapture]);

  useEffect(() => {
    if (!isDebugLoggingEnabled()) return;
    debugLog('capture', 'Capture capability snapshot', {
      autoCapture: effectivePreferences.autoCapture,
      canReadClipboard,
      permissionState
    });
  }, [canReadClipboard, effectivePreferences.autoCapture, permissionState]);

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
      showToast('Copied.');
    },
    [showToast, updateItem]
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

  const toggleSettingsSection = useCallback((sectionId) => {
    setSettingsSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  const devMode = import.meta.env.DEV;

  return (
    <div className={effectivePreferences.compactMode ? 'layout density-compact shell-minimal' : 'layout density-comfortable shell-minimal'}>
      <Header onSignOut={signOutUser} onExport={exportData} user={user} profile={profile} />

      <section className='workspace-bar'>
        <div className={`status-pill tone-${syncBadge.tone}`}>
          <span className='status-dot' />
          {syncBadge.label}
        </div>
        <div className='workspace-tools'>
          <div className='search-shell'>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder='Search notes, links, code or people...'
            />
          </div>
          <button className='btn subtle' onClick={captureClipboard}>Capture</button>
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

      <main className='content timeline-layout'>
        <section className='composer panel-surface soft-panel'>
          <textarea
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder='Quick note, paste, idea, snippet...'
          />
          <div className='composer-actions'>
            <div className='filters compact-filters'>
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
            <button className='btn-strong' onClick={saveManual}>Save note</button>
          </div>
        </section>

        <section className='feed feed-focused'>
          <div className='timeline-scroll timeline-clean'>
            {filteredItems.length === 0 ? (
              <div className='empty-state minimal-empty'>
                <h3>Nothing here yet</h3>
                <p>Capture something to start your timeline.</p>
              </div>
            ) : (
              Object.entries(sections).map(([section, sectionItems]) => {
                if (!sectionItems.length) return null;
                return (
                  <div key={section} className='timeline-section'>
                    <div className='timeline-heading'>
                      <h3 className='timeline-label'>{section}</h3>
                      {section === 'ARCHIVE' ? (
                        <button className='mini-action ghost' onClick={() => setArchiveCollapsed((value) => !value)}>
                          {archiveCollapsed ? 'Expand' : 'Collapse'}
                        </button>
                      ) : null}
                    </div>

                    <div className='timeline-list'>
                      {sectionItems.map((item) => (
                        <article key={item.id} className='timeline-card'>
                          <div className='timeline-card-main'>
                            <div className='timeline-icon-block'>
                              <span className='timeline-type-icon'>{iconLabelForItem(item)}</span>
                              <span className={`sync-dot sync-${statusTone(item.syncState)}`} />
                            </div>

                            <div className='timeline-content-block'>
                              <div className='timeline-content-top'>
                                <p className='timeline-preview'>{item.preview || 'Clipboard entry'}</p>
                                <div className='timeline-card-actions'>
                                  <button className='icon-button' onClick={() => copyItem(item)} aria-label='Copy item'>
                                    <IconCopy />
                                  </button>
                                  <button className='icon-button' onClick={() => updateItem(item, { pinned: !item.pinned })} aria-label='Pin item'>
                                    <IconPin />
                                  </button>
                                </div>
                              </div>

                              <div className='timeline-meta'>
                                <span>{new Date(item.updatedAt || item.createdAt).toLocaleString()}</span>
                                <span>{item.contentType}</span>
                                {item.contentType === 'url' ? <span>{getDomain(String(item.content || ''))}</span> : null}
                                {item.lastSyncError ? <span className='item-error-inline'>{item.lastSyncError}</span> : null}
                              </div>

                              {!effectivePreferences.hidePreviews ? (
                                <div className={effectivePreferences.blurSensitiveContent && item.sensitive ? 'timeline-body blur-sensitive' : 'timeline-body'}>
                                  {item.kind === 'image' ? (
                                    <img className='entry-image' src={item.content} alt='Clipboard capture' loading='lazy' />
                                  ) : (
                                    <pre>{item.contentType === 'code' ? cleanText(item.content) : String(item.content || '')}</pre>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </main>

      <div className='footer-dock-shell'>
        <footer className='footer-minimal'>
          <div className='footer-left'>
            <span className={`dock-status-dot tone-${syncBadge.tone}`} />
            <IconCloud className={`dock-cloud tone-${isOnline ? 'synced' : 'offline'}`} />
          </div>

          <div className='footer-center' />

          <div className='footer-right'>
            <button className='dock-icon' onClick={() => flushOutbox('footer-sync')} aria-label='Sync now'>
              <IconSync />
            </button>
            <button className='dock-icon' onClick={() => updatePreferences({ compactMode: !effectivePreferences.compactMode })} aria-label='Display settings'>
              <IconDisplay />
            </button>
            <button className={`dock-icon${accountMenuOpen ? ' active' : ''}`} onClick={() => setAccountMenuOpen((value) => !value)} aria-label='Account'>
              <IconUser />
            </button>
            <button className={`dock-icon${settingsOpen ? ' active' : ''}`} onClick={() => setSettingsOpen(true)} aria-label='Settings'>
              <IconSettings />
            </button>
          </div>
        </footer>

        {accountMenuOpen ? (
          <div className='account-popover'>
            <strong>{profile?.displayName || user.displayName || 'User'}</strong>
            <span>{profile?.email || user.email || '-'}</span>
            <button className='btn' onClick={clearCache}>Clear local cache</button>
          </div>
        ) : null}
      </div>

      <div className={settingsOpen ? 'settings-overlay is-open' : 'settings-overlay'} onClick={() => setSettingsOpen(false)}>
        <aside
          className={settingsOpen ? 'settings-drawer is-open' : 'settings-drawer'}
          onClick={(event) => event.stopPropagation()}
          aria-hidden={!settingsOpen}
        >
          <div className='settings-drawer-head'>
            <div>
              <h2>Settings</h2>
              <p>Quiet controls for this device and account.</p>
            </div>
            <button className='btn' onClick={() => setSettingsOpen(false)}>Close</button>
          </div>

          {preferencesNotice ? <p className='settings-note'>{preferencesNotice}</p> : null}

          {SETTINGS_SECTIONS.map((section) => (
            <section key={section.id} className='settings-group'>
              <button className='settings-group-toggle' onClick={() => toggleSettingsSection(section.id)}>
                <span>{section.label}</span>
                <IconChevron className={settingsSections[section.id] ? 'chevron-open' : 'chevron-closed'} />
              </button>

              {settingsSections[section.id] ? (
                <div className='settings-group-body'>
                  {section.id === 'general' ? (
                    <>
                      <label className='switch'>
                        <input type='checkbox' checked={keepSignedIn} onChange={(event) => setKeepSignedIn(event.target.checked)} />
                        Keep signed in
                      </label>
                      <label>
                        Theme
                        <select value={effectivePreferences.themeId} onChange={(event) => updatePreferences({ themeId: event.target.value })}>
                          {THEME_OPTIONS.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
                        </select>
                      </label>
                      <label>
                        Mode
                        <select value={effectivePreferences.themeMode} onChange={(event) => updatePreferences({ themeMode: event.target.value })}>
                          <option value='dark'>Dark</option>
                          <option value='light'>Light</option>
                        </select>
                      </label>
                    </>
                  ) : null}

                  {section.id === 'sync' ? (
                    <>
                      <label className='switch'>
                        <input type='checkbox' checked={effectivePreferences.autoSyncPending} onChange={(event) => updatePreferences({ autoSyncPending: event.target.checked })} />
                        Auto-sync pending items
                      </label>
                      <label className='switch'>
                        <input type='checkbox' checked={effectivePreferences.autoCapture} onChange={(event) => updatePreferences({ autoCapture: event.target.checked })} />
                        Auto capture clipboard
                      </label>
                      <label>
                        Poll interval
                        <select value={effectivePreferences.captureIntervalSec} onChange={(event) => updatePreferences({ captureIntervalSec: Number(event.target.value) })}>
                          <option value='2'>2 sec</option>
                          <option value='3'>3 sec</option>
                          <option value='5'>5 sec</option>
                          <option value='10'>10 sec</option>
                        </select>
                      </label>
                      <button className='btn' onClick={() => flushOutbox('drawer-sync')} disabled={!isOnline || isSyncing}>
                        {isSyncing ? 'Syncing…' : 'Sync now'}
                      </button>
                    </>
                  ) : null}

                  {section.id === 'display' ? (
                    <>
                      <label className='switch'>
                        <input type='checkbox' checked={effectivePreferences.compactMode} onChange={(event) => updatePreferences({ compactMode: event.target.checked })} />
                        Compact density
                      </label>
                      <label className='switch'>
                        <input type='checkbox' checked={effectivePreferences.hidePreviews} onChange={(event) => updatePreferences({ hidePreviews: event.target.checked })} />
                        Hide previews
                      </label>
                    </>
                  ) : null}

                  {section.id === 'privacy' ? (
                    <>
                      <label className='switch'>
                        <input type='checkbox' checked={effectivePreferences.blurSensitiveContent} onChange={(event) => updatePreferences({ blurSensitiveContent: event.target.checked })} />
                        Blur sensitive content
                      </label>
                      {devMode ? (
                        <div className='diagnostics-panel diagnostics-inline'>
                          <div className='diagnostics-head'>
                            <h3>Developer diagnostics</h3>
                            <button className='btn' onClick={() => navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))}>Copy</button>
                          </div>
                          <pre>{JSON.stringify(diagnostics, null, 2)}</pre>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
          ))}
        </aside>
      </div>

      {toast ? <div className='toast'><span>{toast}</span></div> : null}
    </div>
  );
}
