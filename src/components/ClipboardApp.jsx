import { useEffect, useMemo, useRef, useState } from 'react';
import { readClipboardSnapshot } from '../services/clipboard';
import { FREE_BYTES, canStore, formatBytes, usageBytes } from '../utils/quota';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useTheme } from '../hooks/useTheme';
import { Header } from './Header';
import { signOutUser } from '../services/authService';
import { useAuth } from './AuthProvider';
import { watchAccessibleClipboardItems, createCloudItem, updateCloudItem, deleteCloudItem, createSharedCollection, buildShareLink } from '../services/cloudClipboardService';
import { clearApplicationCaches } from '../services/cacheService';
import { detectContentType, getDomain, getItemActions } from '../features/clipboard/contentIntelligence';
import { groupByTimeline } from '../features/clipboard/timeline';
import { cleanText, formatForCopy } from '../features/clipboard/textTools';
import { compareTextEntries } from '../features/clipboard/diff';
import { extractSnippetVariables, renderSnippet } from '../features/clipboard/snippets';
import { buildDashboardStats } from '../features/dashboard/stats';
import { normalizeItem, mergeById, createItemFromText } from '../features/clipboard/model';

const SETTINGS_DEFAULT = { theme: 'midnight-vault', autoCapture: true, pollingMs: 3000, quotaBytes: FREE_BYTES, captureTarget: 'local', keepSignedIn: true, blurSensitive: false, hidePreviews: false, pinLockEnabled: false, appPin: '', autoLockMinutes: 5, sharingDefaultVisibility: 'personal' };
const THEMES = [['midnight-vault', 'Midnight Vault'], ['arctic-glass', 'Arctic Glass'], ['neon-cyber', 'Neon Cyber'], ['royal-indigo', 'Royal Indigo']];
const FILTERS = ['all', 'local', 'synced', 'shared', 'pinned', 'url', 'email', 'phone', 'json', 'code', 'image', 'markdown'];
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
  const lastCaptureRef = useRef(null);
  const lockTimerRef = useRef(null);

  const prefs = { ...SETTINGS_DEFAULT, ...settings, keepSignedIn };
  useTheme(prefs.theme);
  useEffect(() => setSettings((p) => ({ ...p, keepSignedIn })), [keepSignedIn, setSettings]);
  useEffect(() => watchAccessibleClipboardItems(user, setCloudItems, () => setError('Cloud sync unavailable.')), [user]);
  useEffect(() => { if (navigator.permissions?.query) navigator.permissions.query({ name: 'clipboard-read' }).then((r) => setPermission(r.state)).catch(() => setPermission('unknown')); }, []);
  useEffect(() => { const on = () => setIsOnline(true); const off = () => setIsOnline(false); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  useEffect(() => { const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen((v) => !v); } if (e.key === 'Escape') setCommandOpen(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  useEffect(() => {
    if (!prefs.pinLockEnabled || !prefs.appPin) return;
    const reset = () => { if (lockTimerRef.current) clearTimeout(lockTimerRef.current); lockTimerRef.current = setTimeout(() => setLocked(true), Math.max(1, Number(prefs.autoLockMinutes)) * 60000); };
    const touch = () => !locked && reset();
    ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach((evt) => window.addEventListener(evt, touch)); reset();
    return () => { if (lockTimerRef.current) clearTimeout(lockTimerRef.current); ['mousemove', 'keydown', 'touchstart', 'scroll'].forEach((evt) => window.removeEventListener(evt, touch)); };
  }, [prefs.pinLockEnabled, prefs.appPin, prefs.autoLockMinutes, locked]);

  const local = useMemo(() => localItems.map((i) => normalizeItem(i, { scope: 'local', ownerId: user.uid, ownerEmail: user.email })), [localItems, user.uid, user.email]);
  const cloud = useMemo(() => cloudItems.map((i) => normalizeItem(i, { scope: i.scope })), [cloudItems]);
  const items = useMemo(() => mergeById(local, cloud), [local, cloud]);
  const used = useMemo(() => usageBytes(local), [local]);
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

  async function capture(auto = false) {
    try {
      const snap = await readClipboardSnapshot();
      if (auto && lastCaptureRef.current?.content === snap.content && lastCaptureRef.current?.kind === snap.kind) return;
      const item = normalizeItem(snap, { scope: prefs.captureTarget, ownerId: user.uid, ownerEmail: user.email }); item.contentType = detectContentType(item); item.sensitive = ['email', 'phone'].includes(item.contentType);
      if (prefs.captureTarget === 'synced') await createCloudItem(user, item, { visibility: prefs.sharingDefaultVisibility }); else safeStoreLocal(item);
      setStatus(`Captured ${prefs.captureTarget}.`); setError(''); lastCaptureRef.current = snap;
    } catch (e) { setError(toMsg(e)); }
  }
  useEffect(() => { if (!prefs.autoCapture || locked) return; capture(true); const t = setInterval(() => capture(true), prefs.pollingMs); return () => clearInterval(t); }, [prefs.autoCapture, prefs.pollingMs, prefs.captureTarget, locked]);

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
  async function syncLocalItem(item) { await createCloudItem(user, item, { visibility: detail?.visibility || prefs.sharingDefaultVisibility, sharedWith: csv(detail?.sharedWith || '') }); setLocalItems((arr) => arr.filter((i) => i.id !== item.id)); setDetailId(''); }
  async function clearCache() { await clearApplicationCaches(user.uid); setLocalItems([]); setSnippets([]); setStatus('Local cache cleared. Synced data preserved.'); }
  async function saveManual() { const text = manualText.trim(); if (!text) return; const item = createItemFromText(text, 'manual'); item.contentType = detectContentType(item); if (prefs.captureTarget === 'synced') await createCloudItem(user, item, { visibility: prefs.sharingDefaultVisibility }); else safeStoreLocal(item); setManualText(''); }
  function addSnippet() { if (!snippetName.trim() || !snippetTemplate.trim()) return; setSnippets((arr) => [{ id: `${Date.now()}`, name: snippetName.trim(), template: snippetTemplate.trim() }, ...arr]); setSnippetName(''); setSnippetTemplate(''); }
  async function useSnippet(snippet) { const vars = extractSnippetVariables(snippet.template); const values = {}; vars.forEach((name) => { values[name] = window.prompt(`Value for {${name}}`, name === 'date' ? new Date().toLocaleDateString() : '') || ''; }); const out = renderSnippet(snippet.template, values); const item = createItemFromText(out, 'snippet'); item.contentType = detectContentType(item); if (prefs.captureTarget === 'synced') await createCloudItem(user, item, { visibility: prefs.sharingDefaultVisibility }); else safeStoreLocal(item); }
  const commands = [{ id: 'search', label: 'Search clipboard', run: () => setSearch(commandQuery) }, { id: 'snippet', label: 'Create snippet', run: () => setSettingsOpen(true) }, { id: 'settings', label: 'Open settings', run: () => setSettingsOpen(true) }, { id: 'clear', label: 'Clear app cache', run: () => setClearOpen(true) }, { id: 'theme', label: 'Toggle theme', run: () => setSettings((p) => ({ ...p, theme: THEMES[(THEMES.findIndex((x) => x[0] === p.theme) + 1) % THEMES.length][0] })) }, { id: 'share', label: 'Create shared item', run: () => filtered[0] && setDetailId(filtered[0].id) }, { id: 'dashboard', label: 'Open dashboard', run: () => setDashboardOpen(true) }].filter((cmd) => cmd.label.toLowerCase().includes(commandQuery.toLowerCase()));

  if (locked) return <div className="lock-screen"><div className="lock-card"><h2>Vault locked</h2><input type="password" value={unlockPin} onChange={(e) => setUnlockPin(e.target.value)} placeholder="Enter PIN" /><button className="btn-strong" onClick={() => (unlockPin === prefs.appPin ? (setLocked(false), setUnlockPin('')) : setError('Invalid PIN.'))}>Unlock</button></div></div>;

  return (
    <div className="layout">
      <Header onSignOut={signOutUser} onExport={() => { const blob = new Blob([JSON.stringify({ localItems, settings: prefs, snippets }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'clipboard-export.json'; a.click(); URL.revokeObjectURL(url); }} onToggleSettings={() => setSettingsOpen((v) => !v)} user={user} profile={profile} />
      <section className="status-line" role="status"><span>{status}</span>{error ? <span className="status-error">{error}</span> : null}{!isOnline ? <span className="status-error">Offline</span> : null}<span className="status-permission">permission: {permission}</span></section>
      {dashboardOpen ? <section className="dashboard"><div className="dashboard-head"><h2>Dashboard</h2><button className="btn" onClick={() => setDashboardOpen(false)}>Hide</button></div><div className="dashboard-grid"><div className="metric"><span>Total</span><strong>{dashboard.total}</strong></div><div className="metric"><span>Local</span><strong>{dashboard.local}</strong></div><div className="metric"><span>Synced</span><strong>{dashboard.synced}</strong></div><div className="metric"><span>Shared</span><strong>{dashboard.shared}</strong></div><div className="metric"><span>Pinned</span><strong>{dashboard.pinned}</strong></div><div className="metric"><span>Top copy</span><strong>{dashboard.mostCopied[0]?.count || 0}</strong></div></div></section> : null}
      <main className="content"><section className="feed"><div className="feed-head"><h2>Timeline</h2><div className="filters">{FILTERS.map((name) => <button key={name} className={filter === name ? 'chip active' : 'chip'} onClick={() => setFilter(name)}>{name}</button>)}</div></div><div className="tools-bar"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clipboard..." /><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></div><div className="timeline-scroll">{filtered.length === 0 ? <div className="empty"><h3>No entries yet</h3><p>Copy something and it will appear here.</p></div> : SECTIONS.map((section) => timeline[section]?.length ? <div key={section} className="timeline-section"><h3 className="timeline-label">{section}</h3>{timeline[section].map((item) => <article key={item.id} className={`entry ${highlightId === item.id ? 'entry-highlight' : ''}`}><div className="entry-head"><div><div className="entry-badges"><span className="entry-kind">{item.contentType}</span><span className="scope-pill">{item.scope}</span><span className="scope-pill">{item.visibility || 'personal'}</span></div><h3>{item.details?.title || item.preview || 'Clipboard entry'}</h3><p className="entry-meta">{new Date(item.createdAt).toLocaleString()} | owner: {item.ownerEmail || 'local'}</p></div><div className="entry-actions"><button className="btn" onClick={() => setDetailId(item.id)}>Edit details</button><button className="btn" onClick={() => item.scope === 'local' ? patchLocal(item.id, (v) => ({ ...v, pinned: !v.pinned })) : updateCloudItem(user, item.id, { pinned: !item.pinned })}>{item.pinned ? 'Unpin' : 'Pin'}</button><button className="btn" onClick={() => setCompareIds((c) => c.includes(item.id) ? c.filter((x) => x !== item.id) : c.length === 2 ? [c[1], item.id] : [...c, item.id])}>Compare</button><button className="btn-danger" onClick={() => removeItem(item)}>Delete</button></div></div><div className="smart-actions">{getItemActions(item).map((a) => <button key={a.id} className="mini-action" onClick={() => runSmart(item, a.id)}>{a.label}</button>)}</div><div className="magic-paste"><span>Magic paste:</span><button className="mini-action" onClick={() => copyItem(item, 'plain')}>Plain</button><button className="mini-action" onClick={() => copyItem(item, 'clean')}>Cleaned</button><button className="mini-action" onClick={() => copyItem(item, 'formatted')}>Formatted</button>{item.kind === 'text' ? <button className="mini-action" onClick={() => item.scope === 'local' ? patchLocal(item.id, (v) => ({ ...v, content: cleanText(v.content), preview: cleanText(v.content).slice(0, 120) })) : updateCloudItem(user, item.id, { content: cleanText(item.content), preview: cleanText(item.content).slice(0, 120) })}>Clean text</button> : null}</div><div className={`entry-preview ${prefs.blurSensitive && item.sensitive ? 'blur-sensitive' : ''}`}>{prefs.hidePreviews ? <div className="preview-muted">Preview hidden</div> : item.kind === 'image' ? <img className="entry-image" src={item.content} alt="Clipboard capture" loading="lazy" /> : item.contentType === 'url' ? <div className={highlightId === item.id ? 'link-preview highlight' : 'link-preview'}><p>{getDomain(item.content)}</p><a href={item.content.startsWith('http') ? item.content : `https://${item.content}`} target="_blank" rel="noreferrer">Open link</a></div> : <pre className={highlightId === item.id ? 'code-block highlight' : 'code-block'}>{item.contentType === 'json' || item.contentType === 'code' ? formatForCopy(item) : item.content}</pre>}</div><div className="entry-foot"><span className="size-pill">{item.kind === 'image' ? formatBytes(item.sizeBytes || 0) : formatBytes(new Blob([item.content ?? '']).size)}</span><span className="size-pill">Copied: {item.copyCount || 0}</span><button className="mini-action" onClick={() => navigator.clipboard.writeText(buildShareLink(item.id))}>Share link</button></div></article>)}</div> : null)}</div>{diffRows.length ? <section className="compare-panel"><h3>Compare</h3><div className="diff-grid">{diffRows.slice(0, 200).map((row) => <div key={row.line} className={`diff-row diff-${row.type}`}><span>{row.line}</span><code>{row.left || '-'}</code><code>{row.right || '-'}</code></div>)}</div></section> : null}</section>
      <aside className={settingsOpen ? 'panel settings-panel is-open' : 'panel settings-panel'}><button className="btn close-settings" onClick={() => setSettingsOpen(false)}>Close</button><h3>Settings</h3><div className="panel-block"><h4>Profile</h4><p>{profile?.displayName || user?.displayName || 'User'}</p><p>{profile?.email || user?.email || '-'}</p><label className="switch"><input type="checkbox" checked={keepSignedIn} onChange={(e) => setKeepSignedIn(e.target.checked)} />Keep me signed in</label><p className="setting-note">Clearing browser/site data can remove local cache. Synced/shared data is restored from cloud after login.</p></div><div className="metric-grid"><div className="metric"><span>Local</span><strong>{local.length}</strong></div><div className="metric"><span>Cloud</span><strong>{cloud.length}</strong></div></div><div className="quota"><div className="quota-row"><span>Local quota</span><strong>{formatBytes(prefs.quotaBytes)}</strong></div><div className="quota-track"><div className="quota-fill" style={{ width: `${Math.min(100, Math.round((used / prefs.quotaBytes) * 100))}%` }} /></div><p>{formatBytes(used)} used</p></div><div className="panel-block"><h4>Theme</h4><select value={prefs.theme} onChange={(e) => setSettings((p) => ({ ...p, theme: e.target.value }))}>{THEMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div><div className="panel-block"><h4>Capture</h4><label className="switch"><input type="checkbox" checked={prefs.autoCapture} onChange={(e) => setSettings((p) => ({ ...p, autoCapture: e.target.checked }))} />Auto-capture</label><label className="range-row">Interval: {Math.round(prefs.pollingMs / 1000)}s<input type="range" min="2000" max="10000" step="1000" value={prefs.pollingMs} onChange={(e) => setSettings((p) => ({ ...p, pollingMs: Number(e.target.value) }))} /></label><label>Save target<select value={prefs.captureTarget} onChange={(e) => setSettings((p) => ({ ...p, captureTarget: e.target.value }))}><option value="local">Local</option><option value="synced">Synced</option></select></label></div><div className="panel-block"><h4>Privacy</h4><label className="switch"><input type="checkbox" checked={prefs.blurSensitive} onChange={(e) => setSettings((p) => ({ ...p, blurSensitive: e.target.checked }))} />Blur sensitive</label><label className="switch"><input type="checkbox" checked={prefs.hidePreviews} onChange={(e) => setSettings((p) => ({ ...p, hidePreviews: e.target.checked }))} />Hide previews</label><label className="switch"><input type="checkbox" checked={prefs.pinLockEnabled} onChange={(e) => setSettings((p) => ({ ...p, pinLockEnabled: e.target.checked }))} />Enable PIN lock</label>{prefs.pinLockEnabled ? <><label>PIN<input type="password" value={prefs.appPin} onChange={(e) => setSettings((p) => ({ ...p, appPin: e.target.value }))} /></label><label>Auto-lock<input type="number" min="1" max="120" value={prefs.autoLockMinutes} onChange={(e) => setSettings((p) => ({ ...p, autoLockMinutes: Number(e.target.value) || 1 }))} /></label><button className="btn" onClick={() => setLocked(true)}>Lock now</button></> : null}</div><div className="panel-block"><h4>Snippets</h4><input value={snippetName} onChange={(e) => setSnippetName(e.target.value)} placeholder="Snippet name" /><textarea value={snippetTemplate} onChange={(e) => setSnippetTemplate(e.target.value)} placeholder="Hello {name}" /><button className="btn-strong" onClick={addSnippet}>Create snippet</button>{snippets.length ? <ul className="snippet-list">{snippets.map((s) => <li key={s.id}><div><strong>{s.name}</strong><p>{s.template}</p></div><button className="btn" onClick={() => useSnippet(s)}>Use</button></li>)}</ul> : <p className="setting-note">No snippets yet.</p>}</div><div className="panel-block"><h4>Sharing defaults</h4><label>Visibility<select value={prefs.sharingDefaultVisibility} onChange={(e) => setSettings((p) => ({ ...p, sharingDefaultVisibility: e.target.value }))}><option value="private">Private</option><option value="personal">Personal</option><option value="shared">Shared</option></select></label></div><div className="panel-block"><h4>Manual input</h4><textarea value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="Manual text input..." /><button className="btn-strong" onClick={saveManual}>Save text</button></div><div className="panel-block danger-zone"><h4>Danger zone</h4><button className="btn-danger" onClick={() => setClearOpen(true)}>Clear app cache</button></div></aside></main>
      {detailItem && detail ? <div className="modal-backdrop" onClick={() => setDetailId('')}><div className="modal-card" onClick={(e) => e.stopPropagation()}><h3>Item details</h3><p className="setting-note">Owner: {detailItem.ownerEmail || 'local'}</p><div className="modal-grid"><label>Title<input value={detail.title} onChange={(e) => setDetail((d) => ({ ...d, title: e.target.value }))} /></label><label>Category<input value={detail.category} onChange={(e) => setDetail((d) => ({ ...d, category: e.target.value }))} /></label><label>Email<input value={detail.email} onChange={(e) => setDetail((d) => ({ ...d, email: e.target.value }))} /></label><label>Phone<input value={detail.phone} onChange={(e) => setDetail((d) => ({ ...d, phone: e.target.value }))} /></label><label>Source<input value={detail.source} onChange={(e) => setDetail((d) => ({ ...d, source: e.target.value }))} /></label><label>Visibility<select value={detail.visibility} onChange={(e) => setDetail((d) => ({ ...d, visibility: e.target.value }))}><option value="private">Private</option><option value="personal">Personal</option><option value="shared">Shared</option></select></label><label>Tags<input value={detail.tags} onChange={(e) => setDetail((d) => ({ ...d, tags: e.target.value }))} /></label><label>Share with<input value={detail.sharedWith} onChange={(e) => setDetail((d) => ({ ...d, sharedWith: e.target.value }))} /></label><label>Collection/group<input value={detail.collection} onChange={(e) => setDetail((d) => ({ ...d, collection: e.target.value }))} /></label><label className="wide">Notes<textarea value={detail.description} onChange={(e) => setDetail((d) => ({ ...d, description: e.target.value }))} /></label><label className="switch wide"><input type="checkbox" checked={detail.favorite} onChange={(e) => setDetail((d) => ({ ...d, favorite: e.target.checked }))} />Favorite</label></div><div className="modal-actions">{detailItem.scope === 'local' ? <button className="btn" onClick={() => syncLocalItem(detailItem)}>Sync to cloud</button> : null}<button className="btn-strong" onClick={saveDetails}>Save details</button><button className="btn" onClick={() => setDetailId('')}>Close</button></div></div></div> : null}
      {commandOpen ? <div className="modal-backdrop" onClick={() => setCommandOpen(false)}><div className="command-palette" onClick={(e) => e.stopPropagation()}><h3>Command bar</h3><input autoFocus value={commandQuery} onChange={(e) => setCommandQuery(e.target.value)} placeholder="Type a command..." /><ul>{commands.map((cmd) => <li key={cmd.id}><button onClick={() => { cmd.run(); setCommandOpen(false); }}>{cmd.label}</button></li>)}</ul></div></div> : null}
      {clearOpen ? <div className="modal-backdrop" onClick={() => setClearOpen(false)}><div className="confirm-card" onClick={(e) => e.stopPropagation()}><h3>Clear app cache?</h3><p>This clears local temporary cache and previews only. Synced/shared cloud records remain.</p><div className="modal-actions"><button className="btn-danger" onClick={() => { clearCache().finally(() => setClearOpen(false)); }}>Confirm</button><button className="btn" onClick={() => setClearOpen(false)}>Cancel</button></div></div></div> : null}
    </div>
  );
}
