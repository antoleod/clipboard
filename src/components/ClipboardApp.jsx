import { useEffect, useMemo, useRef, useState } from 'react';
import { readClipboardSnapshot } from '../services/clipboard';
import { FREE_BYTES, canStore, formatBytes, usageBytes } from '../utils/quota';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useTheme } from '../hooks/useTheme';
import { Header } from './Header';
import { signOutUser } from '../services/authService';
import { useAuth } from '../hooks/useAuth';
import { watchAccessibleClipboardItems, createCloudItem, updateCloudItem, deleteCloudItem, createSharedCollection, buildShareLink } from '../services/cloudClipboardService';
import { clearApplicationCaches } from '../services/cacheService';
import { detectContentType, getDomain, getItemActions } from '../features/clipboard/contentIntelligence';
import { groupByTimeline } from '../features/clipboard/timeline';
import { cleanText, formatForCopy } from '../features/clipboard/textTools';
import { compareTextEntries } from '../features/clipboard/diff';
import { extractSnippetVariables, renderSnippet } from '../features/clipboard/snippets';
import { buildDashboardStats } from '../features/dashboard/stats';
import { normalizeItem, mergeById, createItemFromText } from '../features/clipboard/model';

const SETTINGS_DEFAULT = { theme: 'midnight-vault', autoCapture: true, pollingMs: 3000, quotaBytes: FREE_BYTES, captureTarget: 'synced', keepSignedIn: true, blurSensitive: false, hidePreviews: false, pinLockEnabled: false, appPin: '', autoLockMinutes: 5, sharingDefaultVisibility: 'personal', autoSyncLocal: true, settingsVersion: 2 };
const THEMES = [['midnight-vault', 'Midnight Vault'], ['arctic-glass', 'Arctic Glass'], ['neon-cyber', 'Neon Cyber'], ['royal-indigo', 'Royal Indigo']];
const FILTERS = ['all', 'text', 'local', 'synced', 'shared', 'pinned', 'url', 'email', 'phone', 'json', 'code', 'image', 'markdown'];
const SECTIONS = ['Today', 'Yesterday', 'This week', 'Older'];
const toMsg = (e) => (e instanceof Error && e.message ? e.message : 'Action failed.');
const csv = (v = '') => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))];

export default function ClipboardApp() {
  const { user, profile, keepSignedIn, setKeepSignedIn } = useAuth();
  const [localItems, setLocalItems] = useLocalStorage('clipboard-vault-local-items', []);
  const [settings, setSettings] = useLocalStorage('clipboard-vault-settings', SETTINGS_DEFAULT);
  const [snippets, setSnippets] = useLocalStorage('clipboard-vault-snippets', []);
  const [cloudItems, setCloudItems] = useState([]);
  const [status, setStatus] = useState('Ready.');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [permission, setPermission] = useState('unknown');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(true);
  const [detailId, setDetailId] = useState('');
  const [detail, setDetail] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [manualText, setManualText] = useState('');
  const [snippetName, setSnippetName] = useState('');
  const [snippetTemplate, setSnippetTemplate] = useState('');
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [clearOpen, setClearOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [unlockPin, setUnlockPin] = useState('');
  const [highlightId, setHighlightId] = useState('');
  const [isSyncingLocal, setIsSyncingLocal] = useState(false);
  const lastCaptureRef = useRef(null);
  const lockTimerRef = useRef(null);
  const syncInFlightRef = useRef(false);

  const prefs = { ...SETTINGS_DEFAULT, ...settings, keepSignedIn };
  useTheme(prefs.theme);
  useEffect(() => {
    setSettings((prev) => {
      const next = { ...SETTINGS_DEFAULT, ...prev, keepSignedIn };
      if ((prev?.settingsVersion ?? 0) < 2) {
        next.captureTarget = 'synced';
        next.autoSyncLocal = true;
        next.settingsVersion = 2;
      }
      return next;
    });
  }, [keepSignedIn, setSettings]);
  useEffect(() => watchAccessibleClipboardItems(user, setCloudItems, () => setError('Cloud sync unavailable.')), [user]);
  useEffect(() => { if (navigator.permissions?.query) navigator.permissions.query({ name: 'clipboard-read' }).then((r) => setPermission(r.state)).catch(() => setPermission('unknown')); }, []);
  useEffect(() => { const on = () => setIsOnline(true); const off = () => setIsOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  useEffect(() => { const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen((v) => !v); } if (e.key === 'Escape') setCommandOpen(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  useEffect(() => {
    if (!prefs.pinLockEnabled || !prefs.appPin) return;
    const reset = () => { if (lockTimerRef.current) clearTimeout(lockTimerRef.current); lockTimerRef.current = setTimeout(() => setLocked(true), Math.max(1, Number(prefs.autoLockMinutes)) * 60000); };
    const touch = () => !locked && reset();
    ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach((evt) => window.addEventListener(evt, touch)); reset();
    return () => { if (lockTimerRef.current) clearTimeout(lockTimerRef.current);['mousemove', 'keydown', 'touchstart', 'scroll'].forEach((evt) => window.removeEventListener(evt, touch)); };
  }, [prefs.pinLockEnabled, prefs.appPin, prefs.autoLockMinutes, locked]);

  const local = useMemo(() => localItems.map((i) => normalizeItem(i, { scope: 'local', ownerId: user.uid, ownerEmail: user.email })), [localItems, user.uid, user.email]);
  const cloud = useMemo(() => cloudItems.map((i) => normalizeItem(i, { scope: i.scope })), [cloudItems]);
  const items = useMemo(() => mergeById(local, cloud), [local, cloud]);
  const used = useMemo(() => usageBytes(local), [local]);
  const filterCounts = useMemo(() => {
    const c = { all: items.length };
    items.forEach((i) => {
      if (i.scope) c[i.scope] = (c[i.scope] || 0) + 1;
      if (i.pinned) c.pinned = (c.pinned || 0) + 1;
      if (i.contentType) c[i.contentType] = (c[i.contentType] || 0) + 1;
    });
    return c;
  }, [items]);
  const pendingLocalCount = useMemo(() => local.filter((item) => item.pendingSync).length, [local]);
  const dashboard = useMemo(() => buildDashboardStats(items), [items]);
  const filtered = useMemo(() => {
    let next = [...items];
    if (['local', 'synced', 'shared'].includes(filter)) next = next.filter((i) => i.scope === filter);
    if (filter === 'pinned') next = next.filter((i) => i.pinned);
    if (filter !== 'all' && !['local', 'synced', 'shared', 'pinned'].includes(filter)) next = next.filter((i) => i.contentType === filter);
    const q = search.trim().toLowerCase();
    if (q) next = next.filter((i) => `${i.content} ${i.preview} ${i.details?.title || ''}`.toLowerCase().includes(q));
    next.sort((a, b) => (sort === 'oldest' ? new Date(a.createdAt) - new Date(b.createdAt) : new Date(b.createdAt) - new Date(a.createdAt)));
    return next;
  }, [items, filter, search, sort]);
  const timeline = useMemo(() => groupByTimeline(filtered), [filtered]);
  const detailItem = detailId ? items.find((i) => i.id === detailId) : null;
  const diffRows = useMemo(() => compareIds.length === 2 ? compareTextEntries(items.find((i) => i.id === compareIds[0])?.content || '', items.find((i) => i.id === compareIds[1])?.content || '') : [], [compareIds, items]);

  useEffect(() => { if (!detailItem) return setDetail(null); setDetail({ title: detailItem.details?.title || '', description: detailItem.details?.description || '', email: detailItem.details?.email || '', phone: detailItem.details?.phone || '', tags: (detailItem.details?.tags || []).join(', '), category: detailItem.details?.category || '', source: detailItem.details?.source || '', favorite: Boolean(detailItem.details?.favorite), visibility: detailItem.visibility || 'personal', sharedWith: (detailItem.sharedWith || []).join(', '), collection: detailItem.collectionId || '' }); }, [detailItem]);
  const patchLocal = (id, fn) => setLocalItems((arr) => arr.map((item) => (item.id === id ? fn(normalizeItem(item, { scope: 'local' })) : item)));
  const safeStoreLocal = (item) => setLocalItems((arr) => { const normalized = normalizeItem(item, { scope: 'local', ownerId: user.uid, ownerEmail: user.email }); if (!canStore(arr, normalized, prefs.quotaBytes)) throw new Error('Local cache quota reached.'); return [normalized, ...arr]; });

  function saveAsPendingLocal(item, reason = '') {
    safeStoreLocal({ ...item, scope: 'local', pendingSync: true, lastSyncError: reason });
  }

  async function saveWithPreferredTarget(item) {
    if (prefs.captureTarget !== 'synced') {
      safeStoreLocal(item);
      return 'local';
    }

    try {
      await createCloudItem(user, item, { visibility: prefs.sharingDefaultVisibility });
      return 'synced';
    } catch (e) {
      saveAsPendingLocal(item, toMsg(e));
      return 'pending';
    }
  }

  async function syncLocalBatch(itemsToSync, { closeDetail = false, silent = false } = {}) {
    if (!user?.uid || !itemsToSync?.length || syncInFlightRef.current) {
      return { synced: 0, failed: 0 };
    }

    syncInFlightRef.current = true;
    setIsSyncingLocal(true);
    const successIds = new Set();
    const failed = new Map();

    try {
      for (const rawItem of itemsToSync) {
        const item = normalizeItem(rawItem, { scope: 'local', ownerId: user.uid, ownerEmail: user.email });
        try {
          await createCloudItem(user, item, {
            visibility: item.visibility || prefs.sharingDefaultVisibility,
            sharedWith: item.sharedWith || []
          });
          successIds.add(rawItem.id);
        } catch (e) {
          failed.set(rawItem.id, toMsg(e));
        }
      }

      setLocalItems((arr) => {
        let changed = false;
        const next = [];
        for (const item of arr) {
          if (successIds.has(item.id)) {
            changed = true;
            continue;
          }

          if (failed.has(item.id)) {
            const msg = failed.get(item.id);
            if (!item.pendingSync || item.lastSyncError !== msg) changed = true;
            next.push({ ...item, pendingSync: true, lastSyncError: msg });
            continue;
          }

          next.push(item);
        }
        return changed ? next : arr;
      });

      if (!silent) {
        if (successIds.size && failed.size) {
          setStatus(`Synced ${successIds.size} local notes. ${failed.size} are still pending.`);
          setError('Some notes could not sync yet. They remain local and pending.');
        } else if (successIds.size) {
          setStatus(`Synced ${successIds.size} local notes to cloud.`);
          setError('');
        } else if (failed.size) {
          setError('Cloud sync unavailable. Local notes are pending sync.');
        }
      }

      if (closeDetail) setDetailId('');
      return { synced: successIds.size, failed: failed.size };
    } finally {
      syncInFlightRef.current = false;
      setIsSyncingLocal(false);
    }
  }

  async function syncAllLocalItems() {
    if (!localItems.length) {
      setStatus('No local notes to sync.');
      return;
    }
    await syncLocalBatch(localItems);
  }

  async function capture(auto = false) {
    try {
      const snap = await readClipboardSnapshot();
      if (auto && lastCaptureRef.current?.content === snap.content && lastCaptureRef.current?.kind === snap.kind) return;

      const item = normalizeItem(snap, { scope: prefs.captureTarget, ownerId: user.uid, ownerEmail: user.email });
      item.contentType = detectContentType(item);
      item.sensitive = ['email', 'phone'].includes(item.contentType);

      const target = await saveWithPreferredTarget(item);
      if (target === 'pending') {
        setStatus('Captured locally. Pending cloud sync.');
        setError('Cloud sync unavailable right now.');
      } else {
        setStatus(`Captured ${target}.`);
        setError('');
      }
      lastCaptureRef.current = snap;
    } catch (e) {
      setError(toMsg(e));
    }
  }

  useEffect(() => { if (!prefs.autoCapture || locked) return; capture(true); const t = setInterval(() => capture(true), prefs.pollingMs); return () => clearInterval(t); }, [prefs.autoCapture, prefs.pollingMs, prefs.captureTarget, locked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!prefs.autoSyncLocal || !isOnline || locked) return;
    const pendingItems = localItems.filter((item) => item.pendingSync);
    if (!pendingItems.length) return;
    syncLocalBatch(pendingItems, { silent: true }).then(({ synced, failed }) => {
      if (synced > 0) {
        setStatus(`Auto-synced ${synced} pending notes.`);
        if (!failed) setError('');
      }
      if (failed > 0 && !synced) setError('Cloud sync unavailable. Pending notes will retry automatically.');
    });
  }, [localItems, prefs.autoSyncLocal, isOnline, locked]); // eslint-disable-line react-hooks/exhaustive-deps

  async function removeItem(item) { if (item.scope === 'local') return setLocalItems((arr) => arr.filter((i) => i.id !== item.id)); await deleteCloudItem(item.id); }
  async function copyItem(item, mode = 'plain') { if (item.kind === 'image') return; const raw = String(item.content || ''); const out = mode === 'clean' ? cleanText(raw) : mode === 'formatted' ? formatForCopy(item) : raw; await navigator.clipboard.writeText(out); if (item.scope === 'local') patchLocal(item.id, (v) => ({ ...v, copyCount: (v.copyCount || 0) + 1 })); else if (item.ownerId === user.uid) await updateCloudItem(user, item.id, { copyCount: Number(item.copyCount || 0) + 1 }); }
  async function runSmart(item, actionId) {
    const content = String(item.content || '');
    if (actionId === 'open-link') return window.open(content.startsWith('http') ? content : `https://${content}`, '_blank', 'noopener,noreferrer');
    if (actionId === 'copy-domain') return navigator.clipboard.writeText(getDomain(content));
    if (actionId === 'preview-link' || actionId === 'highlight') return setHighlightId(item.id);
    if (actionId === 'send-email') return (window.location.href = `mailto:${content}`);
    if (actionId === 'copy-email' || actionId === 'copy-phone') return navigator.clipboard.writeText(content);
    if (actionId === 'compare') return setCompareIds((c) => c.includes(item.id) ? c.filter((x) => x !== item.id) : c.length === 2 ? [c[1], item.id] : [...c, item.id]);
    return copyItem(item, actionId === 'copy-formatted' ? 'formatted' : 'plain');
  }
  async function saveDetails() {
    if (!detailItem || !detail) return;
    const details = { title: detail.title.trim(), description: detail.description.trim(), email: detail.email.trim(), phone: detail.phone.trim(), tags: csv(detail.tags), category: detail.category.trim(), source: detail.source.trim(), favorite: Boolean(detail.favorite) };
    const patch = { details, pinned: details.favorite || detailItem.pinned, visibility: detail.visibility, sharedWith: csv(detail.sharedWith) };
    if (detailItem.scope === 'local') patchLocal(detailItem.id, (v) => ({ ...v, ...patch }));
    else {
      await updateCloudItem(user, detailItem.id, patch);
      if (detail.collection?.trim()) {
        const collectionId = await createSharedCollection(user, detail.collection.trim(), csv(detail.sharedWith));
        await updateCloudItem(user, detailItem.id, { collectionId });
      }
    }
    setDetailId('');
  }
  async function syncLocalItem(item) { await syncLocalBatch([item], { closeDetail: true }); }
  async function clearCache() { await clearApplicationCaches(user.uid); setLocalItems([]); setSnippets([]); setStatus('Local cache cleared. Synced data preserved.'); }
  async function saveManual() { const text = manualText.trim(); if (!text) return; const item = createItemFromText(text, 'manual'); item.contentType = detectContentType(item); const target = await saveWithPreferredTarget(item); if (target === 'pending') { setStatus('Saved locally. Pending cloud sync.'); setError('Cloud sync unavailable right now.'); } else setError(''); setManualText(''); }
  function addSnippet() { if (!snippetName.trim() || !snippetTemplate.trim()) return; setSnippets((arr) => [{ id: `${Date.now()}`, name: snippetName.trim(), template: snippetTemplate.trim() }, ...arr]); setSnippetName(''); setSnippetTemplate(''); }
  async function applySnippet(snippet) { const vars = extractSnippetVariables(snippet.template); const values = {}; vars.forEach((name) => { values[name] = window.prompt(`Value for {${name}}`, name === 'date' ? new Date().toLocaleDateString() : '') || ''; }); const out = renderSnippet(snippet.template, values); const item = createItemFromText(out, 'snippet'); item.contentType = detectContentType(item); const target = await saveWithPreferredTarget(item); if (target === 'pending') { setStatus('Snippet saved locally. Pending cloud sync.'); setError('Cloud sync unavailable right now.'); } else setError(''); }
  const commands = [{ id: 'search', label: 'Search clipboard', run: () => setSearch(commandQuery) }, { id: 'snippet', label: 'Create snippet', run: () => setSettingsOpen(true) }, { id: 'settings', label: 'Open settings', run: () => setSettingsOpen(true) }, { id: 'sync', label: 'Sync local notes', run: () => syncAllLocalItems() }, { id: 'clear', label: 'Clear app cache', run: () => setClearOpen(true) }, { id: 'theme', label: 'Toggle theme', run: () => setSettings((p) => ({ ...p, theme: THEMES[(THEMES.findIndex((x) => x[0] === p.theme) + 1) % THEMES.length][0] })) }, { id: 'share', label: 'Create shared item', run: () => filtered[0] && setDetailId(filtered[0].id) }, { id: 'dashboard', label: 'Open dashboard', run: () => setDashboardOpen(true) }].filter((cmd) => cmd.label.toLowerCase().includes(commandQuery.toLowerCase()));

  if (locked) return <div className="lock-screen"><div className="lock-card"><h2>Vault locked</h2><input type="password" value={unlockPin} onChange={(e) => setUnlockPin(e.target.value)} placeholder="Enter PIN" /><button className="btn-strong" onClick={() => (unlockPin === prefs.appPin ? (setLocked(false), setUnlockPin('')) : setError('Invalid PIN.'))}>Unlock</button></div></div>;

  return (
    <div className="layout">
      <Header onSignOut={signOutUser} onExport={() => { const blob = new Blob([JSON.stringify({ localItems, settings: prefs, snippets }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'clipboard-export.json'; a.click(); URL.revokeObjectURL(url); }} onToggleSettings={() => setSettingsOpen((v) => !v)} user={user} profile={profile} />
      <section className="status-line" role="status"><span>{status}</span>{error ? <span className="status-error">{error}</span> : null}{!isOnline ? <span className="status-error">Offline</span> : null}{pendingLocalCount ? <span className="status-error">Pending sync: {pendingLocalCount}</span> : null}<span className="status-permission">permission: {permission}</span></section>
      {dashboardOpen ? <section className="dashboard"><div className="dashboard-head"><h2>Dashboard</h2><button className="btn" onClick={() => setDashboardOpen(false)}>Hide</button></div><div className="dashboard-grid"><div className="metric"><span>Total</span><strong>{dashboard.total}</strong></div><div className="metric"><span>Local</span><strong>{dashboard.local}</strong></div><div className="metric"><span>Synced</span><strong>{dashboard.synced}</strong></div><div className="metric"><span>Shared</span><strong>{dashboard.shared}</strong></div><div className="metric"><span>Pinned</span><strong>{dashboard.pinned}</strong></div><div className="metric"><span>Top copy</span><strong>{dashboard.mostCopied[0]?.count || 0}</strong></div></div></section> : null}
      <main className="content"><section className="feed"><div className="feed-head"><h2>Timeline</h2><div className="filters">{FILTERS.map((name) => { const visible = name === 'all' || name === filter || (filterCounts[name] || 0) > 0; return <button key={name} className={`chip ${filter === name ? 'active' : ''} ${visible ? 'visible' : 'hidden'}`} onClick={() => visible && setFilter(name)}>{name}</button> })}</div></div><div className="tools-bar"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clipboard..." /><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div><div className="timeline-scroll">{filtered.length === 0 ? <div className="empty"><h3>No entries yet</h3><p>Copy something and it will appear here.</p></div> : SECTIONS.map((section) => timeline[section]?.length ? <div key={section} className="timeline-section"><h3 className="timeline-label">{section}</h3>{timeline[section].map((item) => <article key={item.id} className={`entry ${highlightId === item.id ? 'entry-highlight' : ''}`}><div className="entry-head"><div><div className="entry-badges"><span className="entry-kind">{item.contentType}</span><span className="scope-pill">{item.scope}</span><span className="scope-pill">{item.visibility || 'personal'}</span>{item.pendingSync ? <span className="scope-pill">pending sync</span> : null}</div><h3>{item.details?.title || item.preview || 'Clipboard entry'}</h3><p className="entry-meta">{new Date(item.createdAt).toLocaleString()} | owner: {item.ownerEmail || 'local'}</p></div><div className="entry-actions"><button className="btn" onClick={() => setDetailId(item.id)}>Edit details</button><button className="btn" onClick={() => item.scope === 'local' ? patchLocal(item.id, (v) => ({ ...v, pinned: !v.pinned })) : updateCloudItem(user, item.id, { pinned: !item.pinned })}>{item.pinned ? 'Unpin' : 'Pin'}</button><button className="btn" onClick={() => setCompareIds((c) => c.includes(item.id) ? c.filter((x) => x !== item.id) : c.length === 2 ? [c[1], item.id] : [...c, item.id])}>Compare</button><button className="btn-danger" onClick={() => removeItem(item)}>Delete</button></div></div><div className="smart-actions">{getItemActions(item).map((a) => <button key={a.id} className="mini-action" onClick={() => runSmart(item, a.id)}>{a.label}</button>)}</div><div className="magic-paste"><span>Magic paste:</span><button className="mini-action" onClick={() => copyItem(item, 'plain')}>Plain</button><button className="mini-action" onClick={() => copyItem(item, 'clean')}>Cleaned</button><button className="mini-action" onClick={() => copyItem(item, 'formatted')}>Formatted</button>{item.kind === 'text' ? <button className="mini-action" onClick={() => item.scope === 'local' ? patchLocal(item.id, (v) => ({ ...v, content: cleanText(v.content), preview: cleanText(v.content).slice(0, 120) })) : updateCloudItem(user, item.id, { content: cleanText(item.content), preview: cleanText(item.content).slice(0, 120) })}>Clean text</button> : null}</div><div className={`entry-preview ${prefs.blurSensitive && item.sensitive ? 'blur-sensitive' : ''}`}>{prefs.hidePreviews ? <div className="preview-muted">Preview hidden</div> : item.kind === 'image' ? <img className="entry-image" src={item.content} alt="Clipboard capture" loading="lazy" /> : item.contentType === 'url' ? <div className={highlightId === item.id ? 'link-preview highlight' : 'link-preview'}><p>{getDomain(item.content)}</p><a href={item.content.startsWith('http') ? item.content : `https://${item.content}`} target="_blank" rel="noreferrer">Open link</a></div> : <pre className={highlightId === item.id ? 'code-block highlight' : 'code-block'}>{item.contentType === 'json' || item.contentType === 'code' ? formatForCopy(item) : item.content}</pre>}</div><div className="entry-foot"><span className="size-pill">{item.kind === 'image' ? formatBytes(item.sizeBytes || 0) : formatBytes(new Blob([item.content ?? '']).size)}</span><span className="size-pill">Copied: {item.copyCount || 0}</span><button className="mini-action" onClick={() => navigator.clipboard.writeText(buildShareLink(item.id))}>Share link</button></div></article>)}</div> : null)}</div>{diffRows.length ? <section className="compare-panel"><h3>Compare</h3><div className="diff-grid">{diffRows.slice(0, 200).map((row) => <div key={row.line} className={`diff-row diff-${row.type}`}><span>{row.line}</span><code>{row.left || '-'}</code><code>{row.right || '-'}</code></div>)}</div></section> : null}</section>
        <aside className={settingsOpen ? 'panel settings-panel is-open' : 'panel settings-panel'}><button className="btn close-settings" onClick={() => setSettingsOpen(false)}>Close</button><h3>Settings</h3><div className="panel-block"><h4>Profile</h4><p>{profile?.displayName || user?.displayName || 'User'}</p><p>{profile?.email || user?.email || '-'}</p><label className="switch"><input type="checkbox" checked={keepSignedIn} onChange={(e) => setKeepSignedIn(e.target.checked)} />Keep me signed in</label><p className="setting-note">Clearing browser/site data can remove local cache. Synced/shared data is restored from cloud after login.</p></div><div className="metric-grid"><div className="metric"><span>Local</span><strong>{local.length}</strong></div><div className="metric"><span>Cloud</span><strong>{cloud.length}</strong></div></div><div className="quota"><div className="quota-row"><span>Local quota</span><strong>{formatBytes(prefs.quotaBytes)}</strong></div><div className="quota-track"><div className="quota-fill" style={{ width: `${Math.min(100, Math.round((used / prefs.quotaBytes) * 100))}%` }} /></div><p>{formatBytes(used)} used</p></div><div className="panel-block"><h4>Theme</h4><select value={prefs.theme} onChange={(e) => setSettings((p) => ({ ...p, theme: e.target.value }))}>{THEMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div><div className="panel-block"><h4>Capture</h4><label className="switch"><input type="checkbox" checked={prefs.autoCapture} onChange={(e) => setSettings((p) => ({ ...p, autoCapture: e.target.checked }))} />Auto-capture</label><label className="range-row">Interval: {Math.round(prefs.pollingMs / 1000)}s<input type="range" min="2000" max="10000" step="1000" value={prefs.pollingMs} onChange={(e) => setSettings((p) => ({ ...p, pollingMs: Number(e.target.value) }))} /></label><label>Save target<select value={prefs.captureTarget} onChange={(e) => setSettings((p) => ({ ...p, captureTarget: e.target.value }))}><option value="synced">Synced (recommended)</option><option value="local">Local only</option></select></label><label className="switch"><input type="checkbox" checked={prefs.autoSyncLocal} onChange={(e) => setSettings((p) => ({ ...p, autoSyncLocal: e.target.checked }))} />Auto-sync pending local notes</label><button className="btn" onClick={syncAllLocalItems} disabled={isSyncingLocal || !localItems.length}>{isSyncingLocal ? 'Syncing...' : `Sync local now (${localItems.length})`}</button></div><div className="panel-block"><h4>Privacy</h4><label className="switch"><input type="checkbox" checked={prefs.blurSensitive} onChange={(e) => setSettings((p) => ({ ...p, blurSensitive: e.target.checked }))} />Blur sensitive</label><label className="switch"><input type="checkbox" checked={prefs.hidePreviews} onChange={(e) => setSettings((p) => ({ ...p, hidePreviews: e.target.checked }))} />Hide previews</label><label className="switch"><input type="checkbox" checked={prefs.pinLockEnabled} onChange={(e) => setSettings((p) => ({ ...p, pinLockEnabled: e.target.checked }))} />Enable PIN lock</label>{prefs.pinLockEnabled ? <><label>PIN<input type="password" value={prefs.appPin} onChange={(e) => setSettings((p) => ({ ...p, appPin: e.target.value }))} /></label><label>Auto-lock<input type="number" min="1" max="120" value={prefs.autoLockMinutes} onChange={
