const $ = (id) => document.getElementById(id);
// The app (app/app.js): this page is its home page, without what needs a
// Google Messages tab (marked ext-only in options.html).
const APP = !!window.MA_APP;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const EVERY = { 0: 'When I click “Back up all now”', 1: 'Every hour', 6: 'Every 6 hours', 12: 'Every 12 hours', 24: 'Every day', 168: 'Every week' };

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return GMLib.normalizeSettings(settings);
}
// One save at a time: each reads the settings and writes them back, so two
// switches flipped together would otherwise lose the first.
let settingsSaved = Promise.resolve();
function saveSettings(patch) {
  settingsSaved = settingsSaved.catch(() => {}).then(async () => chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } }));
  return settingsSaved;
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  // Restart the entrance animation for each new message.
  t.style.display = 'none';
  void t.offsetWidth;
  t.style.display = 'block';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.style.display = 'none'; }, 3000);
}

const STATUS = { verified: ['ok', 'Verified complete'], complete: ['ok', 'Complete'], phone: ['ok', 'From phone'], imported: ['ok', 'Imported'], messages: ['ok', 'Messages saved, photos to fetch'], incomplete: ['warn', 'Unfinished'], problem: ['bad', 'Needs attention'] };
// Where a chat came from: its source (app) and, for a second account in it,
// which one: "Google Messages", "Google Messages · (555) 010-0199", "WhatsApp".
// The main account shows its number or ID too once its app has a second one (accounts.json).
let mainAccounts = {};
const sourceName = (r) => {
  const svc = GMLib.serviceOf(r);
  const acct = r?.account ? (r.account_label || GMLib.accountLabel(r.account)) : multiAccount.has(svc) ? mainAccounts[svc]?.label : null;
  return `${GMLib.serviceLabel(svc)}${acct ? ` · ${acct}` : ''}`;
};
const sourceKey = (r) => `${GMLib.serviceOf(r)}|${GMLib.accountKey(r?.account)}`;
// "From Google Messages 18 · WhatsApp 1 · Telegram 1", once there's more than one.
const appsLine = (rows) => {
  const n = new Map();
  for (const r of rows) { const k = sourceName(r); n.set(k, (n.get(k) || 0) + 1); }
  return n.size > 1 ? `<div class="secondary">From ${[...n].map(([k, v]) => `${esc(k)} ${v.toLocaleString()}`).join(' · ')}</div>` : '';
};
// Text chats (Google Messages, any account) can go back on a phone.
const isText = (r) => !r || GMLib.serviceOf(r) === 'sms';
// Google Messages for Web reads only the phone it's paired with: backing up,
// fetching photos and the backup list are for the main account's chats.
const isLive = (r) => !r || (GMLib.serviceOf(r) === 'sms' && !r.account);
// Badges once there's more than one source: every chat but the main Google
// Messages ones, which get one too when Google Messages has a second account.
let multiAccount = new Set();
function noteAccounts(rows) {
  const by = new Map();
  for (const r of rows || []) { const k = GMLib.serviceOf(r); if (!by.has(k)) by.set(k, new Set()); by.get(k).add(GMLib.accountKey(r.account)); }
  multiAccount = new Set([...by].filter(([, v]) => v.size > 1).map(([k]) => k));
}
const appBadge = (r) => (isLive(r) && !multiAccount.has('sms') ? '' : ` <span class="app-badge" style="--app:${GMLib.SERVICES[GMLib.serviceOf(r)]?.color || '#888'}" title="From ${esc(sourceName(r))}">${esc(sourceName(r))}</span>`);
const statusPill = (st, title = '') => { const [k, label] = STATUS[st] || ['warn', 'Unknown']; return `<span class="st ${k}"${title ? ` title="${esc(title)}"` : ''}>${label}</span>`; };
const when = (ms) => ms ? new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never';

// ---------- tabs ----------
// Archive (the viewer, in this page), Home, Backups (every chat), Phone restore,
// Tools, Settings, Apps (a card per app module). The tab is in the address
// (#backups…), so links from the popup and viewer land on the right one;
// #archive/<viewer address> opens the archive there (#archive/chat-id/<id>,
// #archive/contacts…).
const TABS = ['archive', 'home', 'backups', 'restore', 'tools', 'settings', 'apps'];
const WELCOME = location.hash === '#welcome'; // first install: keep the setup steps showing
let tab = 'home';
let routed = false;
// The menu down the left: the archive's views (data-view, as the viewer names
// them: chats, people, contacts…), then Home to Apps (data-tab).
let archiveView = 'chats';
function markMenu() {
  for (const b of document.querySelectorAll('nav.tabs button[data-tab]')) {
    const on = b.dataset.tab === tab && (tab !== 'archive' || b.dataset.view === archiveView);
    b.setAttribute('aria-selected', String(on));
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
}
// ☰ collapses the menu to its icons (on a narrow window, to the title bar),
// remembered in this browser. Collapsed, each entry's name is its tooltip.
function collapseMenu(collapsed) {
  document.body.classList.toggle('menu-collapsed', collapsed);
  const label = collapsed ? 'Expand the menu' : 'Collapse the menu';
  $('menuBtn').setAttribute('aria-expanded', String(!collapsed));
  $('menuBtn').title = label;
  $('menuBtn').setAttribute('aria-label', label);
  for (const b of document.querySelectorAll('nav.tabs button')) {
    if (collapsed && !b.title) { b.title = b.textContent.trim(); b.dataset.nameTip = '1'; }
    if (!collapsed && b.dataset.nameTip) { b.removeAttribute('title'); delete b.dataset.nameTip; }
  }
  try { localStorage.setItem('ma-menu', collapsed ? 'collapsed' : 'open'); } catch { /* storage blocked */ }
}
$('menuBtn').onclick = () => collapseMenu(!document.body.classList.contains('menu-collapsed'));
try { if (localStorage.getItem('ma-menu') === 'collapsed') collapseMenu(true); } catch { /* storage blocked */ }
void document.body.offsetWidth; // lay it out as it opens, so only later changes animate
document.body.classList.add('menu-ready');
function showTab(name, { push = true } = {}) {
  if (!TABS.includes(name)) name = 'home';
  tab = name;
  markMenu();
  for (const t of TABS) $(`tab-${t}`).hidden = t !== name;
  document.body.classList.toggle('archive-on', name === 'archive');
  if (push && location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  refreshTab();
}
// The viewer's addresses for its views (#chat, #stats…; the rest are their own names).
const VIEW_HASH = { chats: 'chat', stats: 'stats/all' };
document.querySelector('nav.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  if (b.dataset.view) { archiveView = b.dataset.view; openArchive(VIEW_HASH[b.dataset.view] || b.dataset.view); markMenu(); } else showTab(b.dataset.tab);
});

// The archive is the viewer in a frame (viewer.html?library=1&embedded=1),
// loaded the first time the tab opens and again after anything changed the
// backup (a run, an import, a delete), so it never shows a stale copy.
let archiveStale = true;
function openArchive(hash = '') {
  const f = $('archiveFrame');
  if (archiveStale || !f.src) { archiveStale = false; f.src = `viewer.html?library=1&embedded=1${hash ? `#${hash}` : ''}`; }
  else if (hash) f.contentWindow.location.hash = hash;
  if (tab !== 'archive') showTab('archive');
}
// The viewer says which view it's on (ma-view), so the menu shows it, and asks
// for Settings (Delete, no folder yet) by message (ma-settings), as it's in this page.
addEventListener('message', (e) => {
  if (e.source !== $('archiveFrame').contentWindow) return;
  if (e.data?.type === 'ma-view') { archiveView = String(e.data.view || 'chats'); markMenu(); return; }
  if (e.data?.type !== 'ma-settings') return;
  const h = String(e.data.hash || 'home');
  if (h.startsWith('delete:')) { showTab('backups'); askDelete(decodeURIComponent(h.slice(7)), false); }
  else showTab(TABS.includes(h) ? h : 'home');
});
// What a tab shows is read when it's opened (and again when something changes), not all at once.
function refreshTab() {
  if (tab === 'archive') { if (archiveStale || !$('archiveFrame').src) openArchive(); }
  else if (tab === 'home') renderHome();
  else if (tab === 'backups') renderIndex();
  else if (tab === 'restore') renderRestore();
  else if (tab === 'tools') { renderRuns(); renderObsidian(); }
  else if (tab === 'apps') renderApps();
}

// ---------- the settings form ----------
// Basic: what most people ever change. Advanced: the rest.
async function renderForm() {
  const s = await getSettings();
  $('version').textContent = `Version ${chrome.runtime.getManifest().version}`;
  if (document.activeElement !== $('subfolder')) $('subfolder').value = s.downloadsSubfolder;
  if (document.activeElement !== $('caseNote')) $('caseNote').value = s.caseNote;
  $('includeMedia').checked = s.includeMedia;
  $('photoQuality').value = s.fullSize ? 'full' : 'thumb';
  $('photoQuality').disabled = !s.includeMedia;
  $('backupWindow').value = s.backupWindow;
  $('compactCorner').value = s.compactCorner;
  $('compactCorner').disabled = s.backupWindow !== 'corner';
  $('notify').checked = s.notify;
  $('patience').value = String(s.patience);
  $('fullSizeEarly').checked = s.fullSizeEarly;
  $('verifyRead').checked = s.verifyRead;
  $('rawMarkup').checked = s.rawMarkup;
  $('phoneMedia').checked = s.phoneMedia;
  $('obsidian').checked = s.obsidian;
  for (const id of ['skipCodes', 'skipPromos', 'skipAutomated']) $(id).checked = s[id];
  // The Backups tab starts in this order; its own menu changes it while you look.
  if ($('chatSort').value !== s.chatSort || !renderForm.done) $('indexSort').value = s.chatSort === 'auto' ? 'name' : s.chatSort;
  $('chatSort').value = s.chatSort;
  renderForm.done = true;
}
function settingsMode(advanced) {
  $('modeBasic').setAttribute('aria-pressed', String(!advanced));
  $('modeAdvanced').setAttribute('aria-pressed', String(advanced));
  $('basicList').hidden = advanced;
  $('advancedList').hidden = !advanced;
  try { localStorage.setItem('gm-settings-mode', advanced ? 'advanced' : 'basic'); } catch { /* storage blocked */ }
}
$('modeBasic').onclick = () => settingsMode(false);
$('modeAdvanced').onclick = () => settingsMode(true);
try { settingsMode(localStorage.getItem('gm-settings-mode') === 'advanced'); } catch { settingsMode(false); }

// Past runs: the list is short; a run's log (up to 1,500 lines) is only put
// on the page when it's opened.
let runsCache = [];
async function renderRuns() {
  ({ runs: runsCache = [] } = await chrome.storage.local.get('runs'));
  $('runs').innerHTML = runsCache.length ? runsCache.map((r, i) => `
    <details class="run" data-i="${i}">
      <summary><span class="when">${when(Date.parse(r.at))}</span><span class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'}</span>
        <span class="what"><b>${esc(r.kind)}</b> · ${esc(r.target)}<div class="secondary">${esc((r.summary || '').split('\n')[0])}</div></span>
        <button class="copyLog small" data-i="${i}">Copy log</button></summary>
      <pre></pre>
    </details>`).join('') : '<div class="empty">Nothing yet.</div>';
}
$('runs').addEventListener('toggle', (e) => {
  const d = e.target;
  if (!d.open || !d.matches?.('details.run')) return;
  const pre = d.querySelector('pre');
  if (!pre.textContent) pre.textContent = (runsCache[+d.dataset.i]?.log || []).join('\n');
}, true);

async function updateJob(id, patch) {
  const s = await getSettings();
  await saveSettings({ schedules: s.schedules.map((j) => (j.id === id ? { ...j, ...patch } : j)) });
}

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'theme') {
    // handled by its own listener
  } else if (['notify', 'verifyRead', 'fullSizeEarly', 'rawMarkup', 'includeMedia', 'phoneMedia', 'obsidian', 'skipCodes', 'skipPromos', 'skipAutomated'].includes(t.id)) {
    await saveSettings({ [t.id]: t.checked });
    if (t.id === 'includeMedia') $('photoQuality').disabled = !t.checked;
    toast('Saved.');
    // Kept up to date from now on: written in full once, here, where it's quickest.
    if (t.id === 'obsidian' && t.checked) writeObsidian();
  } else if (t.id === 'photoQuality') {
    await saveSettings({ fullSize: t.value === 'full' });
    toast('Saved.');
  } else if (t.id === 'backupWindow') {
    await saveSettings({ backupWindow: t.value });
    $('compactCorner').disabled = t.value !== 'corner';
    toast('Saved.');
  } else if (t.id === 'compactCorner') {
    await saveSettings({ compactCorner: t.value });
    toast('Saved.');
  } else if (t.id === 'chatSort') {
    await saveSettings({ chatSort: t.value });
    $('indexSort').value = t.value === 'auto' ? 'name' : t.value;
    toast('Saved.');
  } else if (t.id === 'patience') {
    await saveSettings({ patience: +t.value });
    toast('Saved.');
  } else if (t.classList.contains('every')) {
    // "Back up by itself": Off takes the chat off the list.
    const item = indexItems.find((x) => x.id === t.dataset.id);
    const s = await getSettings();
    const others = s.schedules.filter((j) => j.id !== t.dataset.id);
    const old = s.schedules.find((j) => j.id === t.dataset.id);
    await saveSettings({ schedules: t.value === 'off' ? others
      : [...others, { ...(old || { id: t.dataset.id, title: item?.title || '', addedAt: Date.now() }), everyHours: +t.value, enabled: true }] });
    toast(t.value === 'off' ? 'It won’t be backed up by itself.' : 'Saved.');
  }
});

// Link-preview pictures live on the linked websites, so saving them needs
// permission to read any website. Asked for only when this is ticked.
const ANY_SITE = { origins: ['https://*/*'] };
chrome.permissions?.contains(ANY_SITE).then((on) => { $('previewPics').checked = on; });
$('previewPics').addEventListener('change', async () => {
  const want = $('previewPics').checked;
  const ok = want ? await chrome.permissions.request(ANY_SITE) : await chrome.permissions.remove(ANY_SITE);
  $('previewPics').checked = want ? ok : !ok;
  toast(want ? (ok ? 'Preview pictures will be saved. “Retry failed photos” fetches ones skipped before.' : 'Not allowed, so preview pictures stay skipped.') : 'Preview pictures from other websites won’t be saved.');
});

$('subfolder').addEventListener('change', async () => {
  await saveSettings({ downloadsSubfolder: $('subfolder').value.trim().replace(/^[\\/]+|[\\/]+$/g, '') });
  toast('Saved.');
});
$('caseNote').addEventListener('change', async () => { await saveSettings({ caseNote: $('caseNote').value.trim() }); toast('Saved.'); });

// The backup folder belongs to the extension: chosen here, kept in the
// extension's own storage, and used by the backup helper on the Messages tab.
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('gm-exporter', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { open.result.close(); resolve(req.result); };
      tx.onerror = () => reject(tx.error);
    };
  });
}
const getDir = () => idb('readonly', (s) => s.get('backupDir'));

async function chooseFolder() {
  let dir;
  try {
    dir = await window.showDirectoryPicker({ id: 'gm-backup', mode: 'readwrite' });
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message);
    return;
  }
  await idb('readwrite', (s) => s.put(dir, 'backupDir'));
  await saveSettings({ folderName: dir.name });
  toast(`Backups will be saved in “${dir.name}”.`);
  libCache = null;
  archiveStale = true;
  renderFolder();
  renderTotal();
  refreshTab();
}

async function renderFolder() {
  const dir = await getDir();
  const state = dir ? await dir.queryPermission({ mode: 'readwrite' }) : null;
  $('folderName').textContent = dir ? `Folder: “${dir.name}”` : 'No folder chosen';
  $('allowFolder').hidden = !dir || state === 'granted';
  $('folderAccess').className = !dir ? 'secondary' : state === 'granted' ? 'secondary ok' : 'secondary warn';
  $('folderAccess').textContent = !dir ? '' : state === 'granted'
    ? 'Access allowed. Automatic backups can save here.'
    : 'Chrome needs your OK again before backups can save here (it asks after Chrome restarts unless you chose “Allow on every visit”).';
  $('welcomeFolder').textContent = dir ? `Using “${dir.name}”` : '';
  $('step1').classList.toggle('done', !!dir);
  $('chooseFolder').textContent = dir ? 'Choose a different folder…' : 'Choose a folder…';
  $('welcome').hidden = !(WELCOME || !dir);
}

$('chooseFolder').onclick = chooseFolder;
$('welcomeChoose').onclick = chooseFolder;
$('welcomeMessages').onclick = () => chrome.runtime.sendMessage({ type: 'gm-open-messages' });
$('welcomeAll').onclick = () => $('totalRun').click();
$('welcomePhone').onclick = () => { showTab('tools'); importAnything(false); };
$('openBackup').onclick = () => openArchive();
$('homeHealth').onclick = () => showTab('backups');

// The backup's summary (data.js and backup-state.json), read once and shared
// by Home, Backups and Phone restore until something changes it. It's only
// read if Chrome already allows that; it never asks just to show it.
let libCache = null;
let libLoading = null;
async function getLib(force = false) {
  if (force) libCache = null;
  if (libCache) return libCache;
  if (!libLoading) {
    libLoading = (async () => {
      const dir = await getDir();
      if (!dir) return { noFolder: true };
      if ((await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') return { dir, needsAccess: true };
      let lib = null;
      try { lib = await libraryRows(dir); } catch { /* unreadable: treated as empty */ }
      // Which ID is each app's main account (shown once an app has a second).
      try { mainAccounts = (await readAccounts({ readText: (p) => textAt(dir, p) })).main; } catch { mainAccounts = {}; }
      if (!lib) return { dir, rows: [], empty: true };
      // A chat whose folder was deleted by hand (in Finder, say) is still listed
      // until it's deleted here too.
      const conv = await dir.getDirectoryHandle('conversations').catch(() => null);
      // Other apps' and other accounts' chats are a level down, in
      // conversations/<App>/ or conversations/<App> (<account>)/: any folder
      // there that isn't a chat itself holds chats.
      const present = new Set();
      if (conv) for await (const [name, h] of conv.entries()) {
        if (h.kind !== 'directory') continue;
        present.add(`conversations/${name}`);
        const isChat = await h.getFileHandle('messages.json').then(() => true, () => false);
        if (!isChat) for await (const [n2, h2] of h.entries()) if (h2.kind === 'directory') present.add(`conversations/${name}/${n2}`);
      }
      for (const r of lib.rows) r.folderGone = !present.has(r.folder);
      return { dir, ...lib };
    })();
  }
  try { libCache = await libLoading; } finally { libLoading = null; }
  return libCache;
}
const accessHtml = (dir) => `<span class="big">Your backups are in “${esc(dir.name)}”</span><div class="secondary">Chrome needs your OK again before the extension can look inside or save more there (it asks again after Chrome restarts). <button class="filled small" data-allow>Allow access</button></div>`;

// The answer to "am I backed up?", and what to do next.
let homeTodo = [];
let homePhotos = [];
async function renderHome() {
  const box = $('homeStatus');
  const lib = await getLib();
  for (const id of ['openBackup', 'totalRun', 'homeHealth']) $(id).disabled = !!lib.noFolder;
  if (lib.noFolder) { box.innerHTML = '<span class="big">Not set up yet</span><div class="secondary">Follow the steps above to make your first backup.</div>'; return; }
  if (lib.needsAccess) { box.innerHTML = accessHtml(lib.dir); return; }
  if (!lib.rows.length) { box.innerHTML = `<span class="big">Nothing backed up yet</span><div class="secondary">${APP ? 'Bring in a phone backup or another app’s chats (Tools → Bring in files…), or back up from Google Messages with the extension.' : 'Click “Back up everything” below, or open a chat in Google Messages, click the 💬 icon at the top right of Chrome and choose “Back up this chat”.'}</div>`; return; }
  const { dir } = lib;
  const v = GMLib.verificationOf(lib.rows, lib.state, '').summary;
  homeTodo = lib.rows.filter((r) => r.id && (r.status === 'incomplete' || r.status === 'problem'));
  homePhotos = lib.rows.filter((r) => r.id && !homeTodo.includes(r) && (r.media?.waiting ?? r.media_pending));
  const photosWaiting = homePhotos.reduce((n, r) => n + (r.media?.waiting ?? r.media_pending ?? 0), 0);
  const messages = lib.rows.reduce((n, r) => n + (r.count || 0), 0);
  const cov = v.coverage;
  const missing = cov ? cov.not_backed_up : 0;
  setBadge(homeTodo.length + lib.rows.filter((r) => r.folderGone).length);
  box.innerHTML = `<span class="big">${homeTodo.length || missing ? '⚠️' : '✅'} ${lib.rows.length.toLocaleString()} chat${lib.rows.length === 1 ? '' : 's'} backed up${homeTodo.length ? `, ${homeTodo.length.toLocaleString()} not finished` : ''}</span>
    <div class="secondary">${messages.toLocaleString()} messages · last saved ${esc(when(Date.parse(lib.exp.updated_at)))} · in the folder “${esc(dir.name)}”</div>${appsLine(lib.rows)}
    ${homeTodo.length ? `<div style="margin-top:8px">${homeTodo.length === 1 ? `“${esc(homeTodo[0].title)}” isn’t` : `${homeTodo.length.toLocaleString()} chats aren’t`} completely saved yet. Nothing is lost: finishing carries on from where it stopped. <button id="homeFinish" class="ext-only tonal small">Finish ${homeTodo.length === 1 ? 'it' : 'them'} now</button></div>`
      : '<div style="margin-top:8px">Every chat in your backup is complete.</div>'}
    ${photosWaiting ? `<div style="margin-top:6px">${photosWaiting.toLocaleString()} photo${photosWaiting === 1 ? '' : 's'} in ${homePhotos.length === 1 ? `“${esc(homePhotos[0].title)}”` : `${homePhotos.length.toLocaleString()} chats`} ${photosWaiting === 1 ? 'is' : 'are'} listed but not fetched yet (from a speed run or a stopped backup). <button id="homePhotos" class="ext-only tonal small">Fetch them now</button></div>` : ''}
    ${cov ? `<div style="margin-top:4px">${missing ? `${missing.toLocaleString()} of the ${cov.in_messages.toLocaleString()} conversations in Google Messages aren’t backed up yet. “Back up everything” saves them.` : `All ${cov.in_messages.toLocaleString()} conversations in Google Messages were found in your backup (checked ${esc(when(Date.parse(cov.scanned_at)))}).`}</div>` : ''}`;
}
function setBadge(n) {
  $('backupsBadge').hidden = !n;
  $('backupsBadge').textContent = n > 99 ? '99+' : String(n);
}
document.addEventListener('click', async (e) => {
  if (e.target.matches('[data-allow]')) {
    const dir = await getDir();
    if (dir && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted') toast('Access allowed.');
    libCache = null;
    refreshTab();
    renderFolder();
  }
  if (e.target.id === 'homeFinish') runChats(homeTodo, false);
  if (e.target.id === 'homePhotos') runPhotos(homePhotos, 'fetch', false);
});
$('allowFolder').onclick = async () => {
  const dir = await getDir();
  if (dir && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted') toast('Access allowed.');
  libCache = null;
  renderFolder();
};

document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('copyLog')) {
    e.preventDefault();
    const { runs = [] } = await chrome.storage.local.get('runs');
    const r = runs[+e.target.dataset.i];
    await navigator.clipboard.writeText([`${r.kind} · ${r.target} · ${r.at}`, r.summary, '', ...(r.log || [])].join('\n'));
    toast('Log copied.');
  }
});

window.GMTheme?.bind($('themeBtn'));
$('theme').value = window.GMTheme?.current() || 'system';
$('theme').addEventListener('change', () => { window.GMTheme.set($('theme').value === 'system' ? null : $('theme').value); toast('Theme saved.'); });
document.addEventListener('gm-theme', () => { $('theme').value = window.GMTheme.current(); });

$('runAll').onclick = async () => {
  const s = await getSettings();
  const ids = s.schedules.filter((j) => j.enabled !== false).map((j) => j.id);
  if (!ids.length) { toast('The backup list is empty.'); return; }
  $('runAll').disabled = true;
  toast('Backing up in the Messages tab. Watch the progress panel there.');
  const res = await chrome.runtime.sendMessage({ type: 'gm-run-now', ids });
  if (!res?.ok) toast(res?.error || 'Could not run.');
  $('runAll').disabled = false;
};

$('clearRuns').onclick = async () => { await chrome.storage.local.set({ runs: [] }); renderRuns(); };

// Refreshes only for what changed, and at most a few times a second: a
// backup's end changes several things at once. Settings re-draw from memory;
// only a finished run (runs) means the backup on disk changed and is re-read.
const pending = new Set();
let pendingT = 0;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const k of ['settings', 'runs']) if (changes[k]) pending.add(k);
  // What an app's web page reader keeps shows on the Apps tab as it comes in.
  if (Object.keys(changes).some((k) => k.startsWith('webcap:'))) pending.add('webcap');
  if (!pending.size) return;
  clearTimeout(pendingT);
  pendingT = setTimeout(() => {
    const keys = new Set(pending);
    pending.clear();
    if (keys.has('settings')) renderForm();
    if (keys.has('runs')) { libCache = null; archiveStale = true; renderTotal(); }
    refreshTab();
  }, 300);
});


// ---------- reading the library ----------

async function folderForReading(ask = true) {
  const dir = await getDir();
  if (!dir) throw new Error('Choose a backup folder first.');
  if ((await dir.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if (!ask || (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Chrome didn’t allow access to the backup folder.');
  }
  return dir;
}

async function fileAt(dir, path) {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
  return (await d.getFileHandle(parts[parts.length - 1])).getFile();
}
const textAt = async (dir, path) => { try { return await (await fileAt(dir, path)).text(); } catch { return null; } };
const jsonAt = async (dir, path) => { try { return JSON.parse((await textAt(dir, path)) || 'null'); } catch { return null; } };

// Every chat's summary row. A library from before version 4 is summarised
// from its data.js and each chat's progress.json (it's converted for good by
// the next backup or import).
async function libraryRows(dir) {
  const dataJs = await textAt(dir, 'data.js');
  if (!dataJs) return null;
  const exp = GMLib.parseIndex(dataJs);
  const rows = [];
  for (const c of exp.conversations || []) {
    if (c.file && !c.messages) rows.push(c);
    else rows.push(GMLib.summarize({ id: c.id, title: c.title, folder: c.folder, progress: await jsonAt(dir, `${c.folder}/progress.json`), compact: c }));
  }
  return { exp, rows, state: await jsonAt(dir, 'backup-state.json') };
}

// ---------- back up everything ----------

$('totalRun').onclick = async () => {
  const s = await getSettings();
  $('totalMsg').textContent = 'Opening the Google Messages tab…';
  const res = await chrome.runtime.sendMessage({ type: 'gm-to-tab', message: { type: 'gm-total', opts: { includeMedia: s.includeMedia, fullSize: s.includeMedia && s.fullSize, verifyRead: s.verifyRead } } });
  $('totalMsg').textContent = res?.ok ? 'Switched to the Google Messages tab: click “Back up everything” in the box there to start. Leave that tab alone while it works.' : res?.error || 'Open Google Messages in a tab first (step 2 above), then try again.';
};

// What the last "Back up everything" covered. Only shown once Chrome allows
// reading the backup folder (it never asks just for this).
async function renderTotal() {
  const box = $('totalStatus');
  try {
    const dir = await folderForReading(false);
    const lib = await libraryRows(dir);
    const run = lib?.state?.run;
    if (!lib || !run) { box.innerHTML = ''; return; }
    const v = GMLib.verificationOf(lib.rows, lib.state, '').summary;
    const c = v.coverage;
    const doneN = run.done?.length || 0;
    box.innerHTML = `<div class="coverage">${run.finished_at
      ? `<b>Last run finished ${esc(when(Date.parse(run.finished_at)))}.</b>`
      : `<b>Started ${esc(when(Date.parse(run.started_at)))}, stopped after ${doneN.toLocaleString()} of ${(run.total || 0).toLocaleString()} chats.</b> “Back up everything…” carries on from there.`}
      ${c ? `<div>${c.backed_up.toLocaleString()} of the ${c.in_messages.toLocaleString()} conversations in Messages are completely backed up${c.not_backed_up ? `, ${c.not_backed_up.toLocaleString()} not backed up yet` : ''}${c.unfinished ? `, ${c.unfinished.toLocaleString()} unfinished` : ''}. Details under Backup health.</div>` : ''}</div>`;
  } catch {
    box.innerHTML = '';
  }
}

// ---------- every chat (the backup index) ----------
// One row per chat that's in the backup, on the automatic list, or both,
// with its status, photos and how often it's backed up by itself. Filters
// and search work on what's already read; rows are drawn 150 at a time.

const mc = (r) => r?.media || { full: 0, same: 0, thumbnail: 0, original: r?.media_saved || 0, waiting: r?.media_pending || 0, failed: r?.media_failed || 0, skipped: r?.media_skipped || 0, left: 0 };
const FILTERS = [
  ['all', 'All', () => true],
  ['attention', 'Needs attention', (x) => x.row && (x.row.status === 'problem' || x.row.folderGone || mc(x.row).failed)],
  ['unfinished', 'Unfinished', (x) => x.row?.status === 'incomplete' || (x.job && !x.row)],
  ['photos', 'Photos to fetch', (x) => mc(x.row).waiting > 0],
  ['thumbs', 'Thumbnails', (x) => mc(x.row).thumbnail > 0],
  ['auto', 'Backed up by itself', (x) => x.job && x.job.enabled !== false && x.job.everyHours > 0],
];
let indexItems = [];
let indexFilter = 'all';
let indexShown = 150;
let health = { rows: [], unfinished: [], waiting: [], thumbs: [], failed: [], missing: [] };

async function renderIndex() {
  const lib = await getLib();
  const s = await getSettings();
  const jobs = new Map(s.schedules.map((j) => [j.id, j]));
  if (lib.noFolder) { $('index').innerHTML = '<div class="empty">Choose a backup folder first: Settings → Backup folder.</div>'; return; }
  if (lib.needsAccess) { $('index').innerHTML = `<div class="home-status">${accessHtml(lib.dir)}</div>`; return; }
  const rows = lib.rows || [];
  const seen = new Set();
  indexItems = rows.map((r) => { if (r.id) seen.add(r.id); return { id: r.id || `folder:${r.folder}`, title: r.title, row: r, job: r.id ? jobs.get(r.id) : null }; });
  for (const j of s.schedules) if (!seen.has(j.id)) indexItems.push({ id: j.id, title: j.title, row: null, job: j });
  const cov = lib.exp ? GMLib.verificationOf(rows, lib.state, chrome.runtime.getManifest().version).full.coverage : null;
  health = {
    rows,
    unfinished: indexItems.filter((x) => x.id && !x.id.startsWith('folder:') && isLive(x.row) && (x.row?.status === 'incomplete' || (x.job && !x.row))).map((x) => x.row || { id: x.id, title: x.title }),
    waiting: rows.filter((r) => r.id && isLive(r) && mc(r).waiting),
    thumbs: rows.filter((r) => r.id && isLive(r) && mc(r).thumbnail),
    failed: rows.filter((r) => r.id && isLive(r) && (mc(r).failed || (mc(r).skipped && $('previewPics').checked))),
    missing: cov ? [...cov.not_backed_up, ...cov.unfinished.filter((u) => !rows.some((r) => r.id === u.id))] : [],
  };
  // Fix-everything buttons, only for what applies.
  $('indexFix').innerHTML = [
    health.unfinished.length && `<button id="continueAll" class="filled small">Continue ${health.unfinished.length.toLocaleString()} unfinished</button>`,
    health.missing.length && `<button id="backupMissing" class="tonal small" title="Conversations in Google Messages that aren’t in the backup yet">Back up ${health.missing.length.toLocaleString()} not backed up yet</button>`,
    health.waiting.length && `<button id="fetchAll" class="tonal small" title="Goes back in each chat only as far as its oldest photo to fetch">Fetch ${sum(health.waiting, 'waiting').toLocaleString()} photos</button>`,
    health.thumbs.length && `<button id="upgradeAll" class="tonal small" title="Opens each one in Google Messages’ viewer and replaces the thumbnail">Upgrade ${sum(health.thumbs, 'thumbnail').toLocaleString()} thumbnails</button>`,
    health.failed.length && '<button id="retryAll" class="outlined small">Retry failed photos</button>',
  ].filter(Boolean).join('');
  setBadge(indexItems.filter(FILTERS[1][2]).length);
  drawIndex();
}

function drawIndex() {
  const q = $('indexFind').value.trim().toLowerCase();
  // A filter per source (an app, or a second account in one), once there's more than one.
  noteAccounts(indexItems.map((x) => x.row).filter(Boolean));
  const sources = new Map(indexItems.map((x) => [sourceKey(x.row), sourceName(x.row)]));
  const filters = sources.size > 1 ? [...FILTERS, ...[...sources].map(([k, label]) => [`app:${k}`, label, (x) => sourceKey(x.row) === k])] : FILTERS;
  const counts = filters.map(([id, , f]) => indexItems.filter(f).length);
  $('indexFilters').innerHTML = filters.map(([id, label], i) => (i === 0 || counts[i] ? `<button data-filter="${id}" aria-pressed="${indexFilter === id}">${label}<span class="n">${counts[i].toLocaleString()}</span></button>` : '')).join('');
  const f = (filters.find(([id]) => id === indexFilter) || FILTERS[0])[2];
  // Favourites, then names A–Z, then numbers (as every list of chats), or by
  // the latest message or the most messages (Settings → Order of chats and people).
  const sort = $('indexSort').value;
  const byName = GMLib.chatOrder((x) => !!x.row && GMLib.isFavourite(x.row));
  const order = sort === 'recent' ? (a, b) => String(b.row?.last || '').localeCompare(String(a.row?.last || '')) || byName(a, b)
    : sort === 'count' ? (a, b) => (b.row?.count || 0) - (a.row?.count || 0) || byName(a, b)
    : byName;
  const list = indexItems.filter((x) => f(x) && (!q || (x.title || '').toLowerCase().includes(q) || GMLib.formatNumber(x.title).toLowerCase().includes(q)))
    .sort((a, b) => order({ ...a, title: a.title || '' }, { ...b, title: b.title || '' }));
  const total = indexItems.reduce((n, x) => n + (x.row?.count || 0), 0);
  $('indexMsg').textContent = indexItems.length ? `${indexItems.length.toLocaleString()} chat${indexItems.length === 1 ? '' : 's'}, ${total.toLocaleString()} messages${list.length !== indexItems.length ? ` · showing ${list.length.toLocaleString()}` : ''}` : '';
  if (!indexItems.length) { $('index').innerHTML = `<div class="empty">${APP ? 'Nothing here yet. Bring in a phone backup or another app’s chats (Tools), or back up from Google Messages with the extension.' : 'Nothing backed up yet, and no chats on the automatic list. Use “Add chats…”, or back up a chat from the 💬 popup.'}</div>`; return; }
  const everyOpts = (j) => `<option value="off"${!j || j.enabled === false ? ' selected' : ''}>Off</option>${Object.entries(EVERY).map(([h, l]) => `<option value="${h}"${j && j.enabled !== false && +h === j.everyHours ? ' selected' : ''}>${l}</option>`).join('')}`;
  const rowHtml = (x, i) => {
    const r = x.row;
    const c = mc(r);
    const status = r?.folderGone ? '<span class="st bad">Folder missing</span><div class="secondary">Its files were deleted outside the extension. Use ⋯ → Delete to take it off the list.</div>'
      : r ? `${statusPill(r.status, (r.problems || []).join(', '))}${r.problems?.length ? `<div class="secondary">${esc(r.problems.join(', '))}</div>` : ''}`
      : `<span class="st warn">Not backed up yet</span>${x.job?.lastResult ? `<div class="secondary">${esc(x.job.lastResult.slice(0, 80))}</div>` : ''}`;
    const canRun = !APP && x.id && !x.id.startsWith('folder:') && isLive(r);
    const menu = [
      canRun && (c.waiting || c.failed) && `<button data-act="fetch">Fetch ${(c.waiting + c.failed).toLocaleString()} photos</button>`,
      canRun && c.thumbnail && `<button data-act="upgrade">Upgrade ${c.thumbnail.toLocaleString()} to full size</button>`,
      r && `<button data-act="open">Open in my backup</button>`,
      r && `<button data-act="delete" class="danger-text" data-delete="${esc(r.folder)}">Delete from backup…</button>`,
    ].filter(Boolean).join('');
    return `<tr class="chat-row" data-i="${i}" data-id="${esc(x.id)}">
      <td class="c-chat"><b>${x.title ? esc(GMLib.formatNumber(x.title)) : '<i class="gray">Unnamed chat</i>'}</b>${appBadge(r)}${r?.pinned ? ' <span title="Pinned in Google Messages">📌</span>' : r && GMLib.isFavourite(r) ? ' <span title="A starred contact on the phone">⭐</span>' : ''}${r ? `<div class="secondary">${(r.count || 0).toLocaleString()} message${r.count === 1 ? '' : 's'} · ${esc((r.first || '?').slice(0, 10))} – ${esc((r.last || '?').slice(0, 10))}${!isText(r) || r.contact?.people?.some((p) => p.num) ? '' : ' · no phone number yet'}</div>` : ''}</td>
      <td>${status}</td>
      <td class="media-cell">${r ? mediaCell(c) : '—'}</td>
      <td class="ext-only">${canRun ? `<select class="every" data-id="${esc(x.id)}" title="Back up by itself">${everyOpts(x.job)}</select>` : ''}</td>
      <td class="actions">${canRun ? `<button class="runNow tonal small" title="${r?.status === 'incomplete' || !r ? 'Carry on backing up this chat' : 'Back up this chat now'}">${r?.status === 'incomplete' || !r ? 'Continue' : 'Back up'}</button>` : ''}${menu ? `<details class="row-menu"><summary title="More" aria-label="More">⋯</summary><div class="menu">${menu}</div></details>` : ''}</td></tr>`;
  };
  const shown = list.slice(0, indexShown);
  $('index').innerHTML = `<table><thead><tr><th>Chat</th><th>Status</th><th class="media-cell">Photos and videos</th><th class="ext-only">By itself</th><th></th></tr></thead><tbody>
    ${shown.map((x) => rowHtml(x, indexItems.indexOf(x))).join('')}</tbody></table>
    ${list.length > shown.length ? `<button class="more-rows tonal" id="indexMore">Show ${Math.min(150, list.length - shown.length).toLocaleString()} more (${(list.length - shown.length).toLocaleString()} left)</button>` : ''}
    ${shown.length ? '' : '<div class="empty">No chats match.</div>'}`;
}
$('indexFind').addEventListener('input', () => { indexShown = 150; drawIndex(); });
$('indexSort').addEventListener('change', () => { indexShown = 150; drawIndex(); });
$('indexFilters').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (!b) return; indexFilter = b.dataset.filter; indexShown = 150; drawIndex(); });
$('indexRefresh').onclick = async () => { $('index').innerHTML = '<div class="skeleton w80"></div><div class="skeleton w60"></div><div class="skeleton w80"></div>'; await getLib(true); renderIndex(); };

const sum = (rows, k) => rows.reduce((n, r) => n + ((r.media || {})[k] ?? (k === 'waiting' ? r.media_pending : 0) ?? 0), 0);
// Every photo and video in a chat, by status, in one cell.
function mediaCell(c) {
  const n = (x) => (x || 0).toLocaleString();
  const parts = [c.full + c.same && `<span class="ok">${n(c.full + c.same)} full size</span>`, c.thumbnail && `${n(c.thumbnail)} thumbnail${c.thumbnail === 1 ? '' : 's'}`, c.original && `${n(c.original)} as sent`,
    c.waiting && `<span class="warn">${n(c.waiting)} not fetched</span>`, c.failed && `<span class="bad">${n(c.failed)} failed</span>`, c.skipped && `<span class="gray">${n(c.skipped)} skipped</span>`, c.left && `<span class="gray">${n(c.left)} copies left out</span>`].filter(Boolean);
  return parts.join(' · ') || '<span class="gray">none</span>';
}

// "Fetch photos" / "Upgrade to full size" for the given chats, in the Google Messages window.
function runPhotos(rows, mode, retryFailed) {
  if (!rows.length) return;
  toast(mode === 'fullsize' ? 'Upgrading in the Google Messages window. Leave it alone until it’s done.' : 'Fetching in the Google Messages window. Leave it alone until it’s done.');
  chrome.runtime.sendMessage({ type: 'gm-to-tab', message: { type: 'gm-media', mode, retryFailed, jobs: rows.map(({ id, title }) => ({ id, title })) } })
    .then((res) => { if (res && !res.ok) toast(res.error || 'Could not run.'); }).catch(() => {});
}

// Rows: click for the chat's checks (from its progress.json); buttons and the ⋯ menu act on it.
$('index').addEventListener('click', async (e) => {
  if (e.target.id === 'indexMore') { indexShown += 150; drawIndex(); return; }
  const tr = e.target.closest('tr.chat-row');
  if (!tr) return;
  const x = indexItems[+tr.dataset.i];
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act) {
    e.target.closest('details')?.removeAttribute('open');
    if (act === 'fetch') runPhotos([x.row], 'fetch', !!mc(x.row).failed);
    if (act === 'upgrade') runPhotos([x.row], 'fullsize', false);
    if (act === 'open') openArchive(`chat-id/${encodeURIComponent(x.row.id || '')}`);
    return; // delete is handled by the [data-delete] listener
  }
  if (e.target.classList.contains('runNow')) {
    e.target.disabled = true;
    e.target.textContent = 'Running…';
    runChats([x.row || { id: x.id, title: x.title }], false);
    return;
  }
  if (e.target.closest('select, details, button, a')) return;
  if (tr.nextElementSibling?.classList.contains('checks')) { tr.nextElementSibling.remove(); return; }
  if (!x.row) return;
  const lib = await getLib();
  const prog = await jsonAt(lib.dir, `${x.row.folder}/progress.json`);
  const items = prog?.checks?.items || GMLib.checkChat([], prog, null).items.filter((i) => i.id === 'start');
  const icon = { ok: '✓', warn: '!', bad: '✗' };
  const row = document.createElement('tr');
  row.className = 'checks';
  row.innerHTML = `<td colspan="5">${items.map((i) => `<div class="check-item"><span class="lv ${i.level}">${icon[i.level]}</span><span><b>${esc(i.label)}</b> <span class="secondary">${esc(i.detail || '')}</span></span></div>`).join('')}
    <div class="secondary" style="margin-top:6px">${esc(x.row.folder)}/progress.json${x.job?.lastTried ? ` · last automatic backup ${esc(when(x.job.lastTried))}: ${esc(x.job.lastResult || '')}` : ''}</div></td>`;
  tr.after(row);
});
// Only one ⋯ menu open at a time.
document.addEventListener('toggle', (e) => {
  if (e.target.matches?.('details.row-menu') && e.target.open) for (const d of document.querySelectorAll('details.row-menu[open]')) if (d !== e.target) d.removeAttribute('open');
}, true);

// Chats are added to the backup list (manual) if needed, then run.
async function runChats(rows, retryFailed) {
  const s = await getSettings();
  const have = new Set(s.schedules.map((j) => j.id));
  const added = rows.filter((r) => !have.has(r.id)).map((r) => ({ id: r.id, title: r.title, everyHours: 0, enabled: true, addedAt: Date.now() }));
  if (added.length) await saveSettings({ schedules: [...s.schedules, ...added] });
  toast('Running in the Messages tab. Leave that tab alone until it’s done.');
  const res = await chrome.runtime.sendMessage({ type: 'gm-run-now', ids: rows.map((r) => r.id), retryFailed });
  if (!res?.ok) toast(res?.error || 'Could not run.');
}
document.addEventListener('click', (e) => {
  if (e.target.id === 'continueAll') runChats(health.unfinished, false);
  if (e.target.id === 'retryAll') runPhotos(health.failed, 'fetch', true);
  if (e.target.id === 'fetchAll') runPhotos(health.waiting, 'fetch', false);
  if (e.target.id === 'upgradeAll') runPhotos(health.thumbs, 'fullsize', false);
  if (e.target.id === 'backupMissing') runChats(health.missing, false);
});

let photoCheck = { missing: [] };
// Opens every photo and video in each chat's master list (media-index.json):
// the file is there, its SHA-256 is unchanged, and a picture decodes at the
// size recorded. Chats backed up before 0.4.5.0 have no list until their next backup.
async function checkPhotos() {
  $('health').innerHTML = '';
  try {
    const dir = await folderForReading();
    const lib = await libraryRows(dir);
    if (!lib?.rows.length) { $('healthMsg').textContent = 'Nothing is backed up yet.'; return; }
    const totals = GMLib.mediaCounts([]);
    const report = [];
    let checked = 0, ok = 0, noList = 0;
    for (const [n, row] of lib.rows.entries()) {
      const index = await jsonAt(dir, `${row.folder}/media-index.json`);
      if (!index?.items) { noList++; continue; }
      const bad = [];
      for (const it of index.items) {
        totals[it.status] = (totals[it.status] || 0) + 1;
        if (!it.file) continue;
        if (++checked % 10 === 0) $('healthMsg').textContent = `Chat ${n + 1} of ${lib.rows.length}: checked ${checked.toLocaleString()} photos and videos…`;
        let file;
        try { file = await fileAt(dir, it.file); } catch { bad.push([it, 'missing']); continue; }
        if (it.sha256 && (await GMLib.sha256(file)) !== it.sha256) { bad.push([it, 'changed since it was saved']); continue; }
        if (it.kind === 'image' && it.width && !/\.(heic|heif)$/i.test(it.file)) {
          try {
            const bmp = await createImageBitmap(file);
            const size = [bmp.width, bmp.height];
            bmp.close();
            if (size[0] !== it.width || size[1] !== it.height) { bad.push([it, `is ${size[0]}×${size[1]}, the list says ${it.width}×${it.height}`]); continue; }
          } catch { bad.push([it, 'won’t open as a picture']); continue; }
        }
        ok++;
      }
      if (bad.length) report.push({ row, bad });
    }
    const problems = report.reduce((n, r) => n + r.bad.length, 0);
    photoCheck = { missing: report.map(({ row, bad }) => ({ row, items: bad.filter(([, why]) => why === 'missing').map(([it]) => it) })).filter((r) => r.items.length) };
    const missingN = photoCheck.missing.reduce((n, r) => n + r.items.length, 0);
    const notSaved = totals.waiting + totals.failed;
    $('healthMsg').textContent = '';
    $('health').innerHTML = `<div class="health-summary"><span class="pill-status ${problems ? 'bad' : 'ok'}">${problems ? 'Problems found' : 'Every saved photo checks out'}</span>
      ${ok.toLocaleString()} of ${checked.toLocaleString()} saved photos and videos are there, unchanged and the size recorded.${problems ? ` ${problems.toLocaleString()} aren’t.` : ''}
      <div style="margin-top:6px">${mediaCell(totals)}</div>
      ${notSaved ? `<div class="secondary" style="margin-top:6px">${notSaved.toLocaleString()} listed but not saved (not fetched yet or failed). “Check for problems” has buttons to fetch them.</div>` : ''}
      ${noList ? `<div class="secondary" style="margin-top:6px">${noList.toLocaleString()} chat${noList === 1 ? ' was' : 's were'} backed up before photos had a list, so ${noList === 1 ? 'it isn’t' : 'they aren’t'} checked here. ${noList === 1 ? 'Its' : 'Their'} next backup makes one.</div>` : ''}</div>
      ${report.map(({ row, bad }) => `<div style="margin-top:8px"><b>${esc(row.title)}</b>${bad.slice(0, 50).map(([it, why]) => `<div class="bad">Message ${it.message_index}${it.item ? `, item ${it.item}` : ''} (${esc(it.file)}): ${esc(why)}</div>`).join('')}${bad.length > 50 ? `<div class="secondary">…and ${bad.length - 50} more</div>` : ''}</div>`).join('')}
      ${missingN ? `<div class="row" style="margin-top:10px"><button id="refetchMissing" class="filled small">Fetch the ${missingN === 1 ? 'missing one' : `${missingN.toLocaleString()} missing ones`} again</button><span class="secondary">Opens ${photoCheck.missing.length === 1 ? 'the chat' : 'each chat'} in Google Messages and saves just ${missingN === 1 ? 'that photo' : 'those'}.</span></div>` : ''}
      ${problems > missingN ? '<div class="secondary" style="margin-top:8px">A photo that changed or won’t open may have been edited or damaged after it was saved. Restore it from another copy of your backup if you have one; otherwise delete the file and check again, and it can be fetched again.</div>' : ''}`;
  } catch (e) {
    $('healthMsg').textContent = e.message;
  }
}
document.addEventListener('click', (e) => { if (e.target.id === 'checkPhotos') checkPhotos(); if (e.target.id === 'refetchMissing') refetchMissing(); });

// Marks the missing ones as not saved in their chat's messages.json, so
// "Fetch photos" (run straight away) finds them, and keeps SHA256SUMS.txt right.
async function refetchMissing() {
  try {
    const io = libraryIO(await folderForReading());
    const rows = [];
    const gone = [];
    for (const { row, items } of photoCheck.missing) {
      const data = JSON.parse((await io.readText(`${row.folder}/messages.json`)) || 'null');
      if (!data?.messages) continue;
      let n = 0;
      for (const it of items) {
        const md = data.messages.find((m) => m.index === it.message_index)?.media?.[it.item - 1];
        if (!md?.file || `${row.folder}/${md.file}` !== it.file) continue;
        gone.push(it.file);
        delete md.file; delete md.sha256; delete md.bytes;
        md.error = 'The file was missing from the backup folder';
        if (it.status === 'full' || it.status === 'same') md.want_full = true;
        n++;
      }
      if (n) { await io.write(`${row.folder}/messages.json`, JSON.stringify(data)); rows.push(row); }
    }
    const sums = GMLib.parseSums(await io.readText('SHA256SUMS.txt'));
    for (const p of gone) sums.delete(p);
    for (const [p, h] of io.hashes) sums.set(p, h);
    await io.write('SHA256SUMS.txt', GMLib.formatSums(sums));
    photoCheck = { missing: [] };
    $('refetchMissing').disabled = true;
    runPhotos(rows, 'fetch', true);
  } catch (e) {
    toast(e.message);
  }
}

// Recomputes the SHA-256 of every file listed in SHA256SUMS.txt.
$('verifySums').onclick = async () => {
  $('health').innerHTML = '';
  try {
    const dir = await folderForReading();
    const sums = await textAt(dir, 'SHA256SUMS.txt');
    if (!sums) { $('healthMsg').textContent = 'No SHA256SUMS.txt in the backup folder yet.'; return; }
    const lines = [...GMLib.parseSums(sums)];
    let ok = 0;
    const changed = [];
    const missing = [];
    for (let i = 0; i < lines.length; i++) {
      const [path, hash] = lines[i];
      if (i % 10 === 0) $('healthMsg').textContent = `Checking ${i + 1} of ${lines.length}…`;
      let file;
      try { file = await fileAt(dir, path); } catch { missing.push(path); continue; }
      if ((await GMLib.sha256(file)) === hash) ok++; else changed.push(path);
    }
    $('healthMsg').textContent = '';
    $('health').innerHTML = `<div class="health-summary"><span class="pill-status ${changed.length || missing.length ? 'bad' : 'ok'}">${changed.length || missing.length ? 'Problems found' : 'All files match'}</span>
      ${ok.toLocaleString()} of ${lines.length.toLocaleString()} files match their checksums.${changed.length ? ` ${changed.length} changed.` : ''}${missing.length ? ` ${missing.length} missing.` : ''}</div>
      ${[...changed.map((p) => `<div class="bad">Changed: ${esc(p)}</div>`), ...missing.map((p) => `<div class="bad">Missing: ${esc(p)}</div>`)].slice(0, 200).join('')}
      <div class="secondary" style="margin-top:8px">Checksums are updated by each backup, so files changed by a backup since then show as matching. Anything else that changed a file is reported here.</div>`;
  } catch (e) {
    $('healthMsg').textContent = e.message;
  }
};

// ---------- a copy for restoring to a phone ----------
// Writes restore-to-phone/sms-<date>.xml in the format of SMS Backup & Restore
// (SyncTech), which can put texts back into an Android phone's messages.
// People are matched by the phone numbers on each chat's contact card.

const xmlEsc = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const { phoneDigits, restoreAddrs } = GMLib;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', mp4: 'video/mp4', '3gp': 'video/3gpp', mov: 'video/quicktime', m4a: 'audio/mp4', mp3: 'audio/mpeg', amr: 'audio/amr', ogg: 'audio/ogg', wav: 'audio/wav' };


// A chat's messages as they go back on a phone: who they're to and from, and
// a time in milliseconds. Times are to the minute, so messages in the same
// minute get a second each, in order, and the phone shows them in order.
// Shared by the restore package and the SMS Backup & Restore file.
function* restoreItems(data, row, withMedia) {
  const people = (data.contact?.people || row.contact?.people || []).filter((p) => phoneDigits(p.number ?? p.num));
  const numberOf = new Map(people.map((p) => [p.name ?? p.n, phoneDigits(p.number ?? p.num)]));
  const addrs = restoreAddrs(people, row.title);
  if (!addrs.length) return;
  const group = addrs.length > 1;
  let minute = null;
  let k = 0;
  for (const m of data.messages) {
    if (!m.timestamp) continue;
    const [day, hm = '12:00'] = m.timestamp.split(' ');
    const base = new Date(`${day}T${hm}`).getTime();
    if (!Number.isFinite(base)) continue;
    k = base === minute ? Math.min(k + 1, 59) : 0;
    minute = base;
    const sent = m.direction === 'sent';
    yield { m, t: base + k * 1000, sent, group, addrs, from: sent ? null : numberOf.get(m.sender) || (group ? null : addrs[0]), media: withMedia ? (m.media || []).filter((x) => x.file) : [] };
  }
}

// The Phone restore tab: what would go into the file, and what can't.
// The text chats a restore file is made of: Google Messages', of the number chosen.
const restoreRows = (lib) => {
  const pick = $('restoreAccountRow').hidden ? '' : $('restoreAccount').value;
  return lib.rows.filter((r) => isText(r) && GMLib.accountKey(r.account) === pick);
};
async function renderRestore() {
  const lib = await getLib();
  const box = $('restoreReady');
  $('exportPhone').disabled = $('exportPackage').disabled = !!(lib.noFolder || lib.needsAccess || !lib.rows?.length);
  if (lib.noFolder) { box.innerHTML = '<div class="empty">Choose a backup folder first: Settings → Backup folder.</div>'; $('restoreLeft').innerHTML = ''; return; }
  if (lib.needsAccess) { box.innerHTML = `<div class="home-status">${accessHtml(lib.dir)}</div>`; $('restoreLeft').innerHTML = ''; return; }
  // Only text chats go back on a phone as texts; other apps' chats stay in the
  // archive. With texts from more than one number, one number at a time.
  noteAccounts(lib.rows);
  const accounts = new Map(lib.rows.filter(isText).map((r) => [GMLib.accountKey(r.account), r.account ? sourceName(r) : `${sourceName(r)} (main)`]));
  $('restoreAccountRow').hidden = accounts.size < 2;
  if (accounts.size > 1) {
    const keep = $('restoreAccount').value;
    $('restoreAccount').innerHTML = [...accounts].map(([k, label]) => `<option value="${esc(k)}"${k === keep ? ' selected' : ''}>${esc(label)}</option>`).join('');
  }
  const rows = restoreRows(lib);
  const ready = rows.filter((r) => restoreAddrs(r.contact?.people, r.title).length);
  const left = rows.filter((r) => !ready.includes(r));
  const msgs = ready.reduce((n, r) => n + (r.count || 0), 0);
  const others = lib.rows.filter((r) => !isText(r)).length;
  const pics = ready.reduce((n, r) => { const c = mc(r); return n + c.full + c.same + c.thumbnail + c.original; }, 0);
  const tile = (n, label, warn) => `<div class="tile${warn ? ' warn' : ''}"><b>${n.toLocaleString()}</b>${label}</div>`;
  box.innerHTML = tile(ready.length, `of ${rows.length.toLocaleString()} chats ready`) + tile(msgs, 'messages') + tile(pics, 'photos and videos') + (left.length ? tile(left.length, 'chats without a phone number', true) : '');
  const canRefresh = left.filter((r) => r.id);
  $('restoreLeft').innerHTML = left.length ? `<div class="fixbar"><span>These have no phone number yet, so they’d be left out: ${left.slice(0, 6).map((r) => ({ ...r, title: GMLib.formatNumber(r.title) })).map((r) => `“${esc(r.title)}”`).join(', ')}${left.length > 6 ? ` and ${(left.length - 6).toLocaleString()} more` : ''}. Backing a chat up again saves its contact card, with the numbers.</span>${canRefresh.length ? `<button class="tonal small" id="restoreRefresh">Back ${canRefresh.length === 1 ? 'it' : 'them'} up again</button>` : ''}</div>` : '';
  restoreLeftRows = canRefresh;
  // Other apps' chats stay in the archive: a phone can only take texts back.
  if (others) $('restoreLeft').insertAdjacentHTML('beforeend', `<div class="secondary" style="margin-top:6px">${others.toLocaleString()} chat${others === 1 ? '' : 's'} from other apps (${esc([...new Set(lib.rows.filter((r) => !isText(r)).map((r) => GMLib.serviceLabel(GMLib.serviceOf(r))))].join(', '))}) ${others === 1 ? 'stays' : 'stay'} in your archive: a phone can only take texts back.</div>`);
}
let restoreLeftRows = [];
$('restoreAccount').onchange = () => renderRestore();
document.addEventListener('click', (e) => { if (e.target.id === 'restoreRefresh') runChats(restoreLeftRows, false); });

// A file's bytes as base64, written a slice at a time (each slice a multiple
// of 3 bytes, so the pieces join up), so a big video never sits in memory whole.
async function writeBase64(w, file) {
  const CH = 3 * 1024 * 1024;
  for (let off = 0; off < file.size; off += CH) {
    const bytes = new Uint8Array(await file.slice(off, off + CH).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    await w.write(btoa(bin));
  }
}

// Writes restore-to-phone/sms-<date>.xml a little at a time: one chat's
// messages.json is read at once, and photos go straight from their files into
// the XML. Years of texts with all their photos make a file of many gigabytes,
// which SMS Backup & Restore reads fine; it's never held in memory here.
$('exportPhone').onclick = async () => {
  const note = (t) => { $('phoneMsg').textContent = t; };
  $('exportPhone').disabled = $('exportPackage').disabled = true;
  let w = null;
  try {
    const dir = await folderForReading();
    const lib = await getLib(true);
    if (!lib.rows?.length) { note('Nothing is backed up yet.'); return; }
    const withMedia = $('phoneMedia').checked;
    const now = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const name = `sms-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.xml`;
    const folder = await dir.getDirectoryHandle('restore-to-phone', { create: true });
    w = await (await folder.getFileHandle(name, { create: true })).createWritable();
    // The count goes at the start of the file but is only known at the end: it's
    // written over a placeholder (spaces between attributes are allowed in XML).
    const pre = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>\n<!-- Made by Message Archivist ${chrome.runtime.getManifest().version} for SMS Backup & Restore. -->\n<smses count="`;
    await w.write(`${pre}${'0"'.padEnd(12)} backup_set="${crypto.randomUUID()}" backup_date="${now.getTime()}" type="full">\n`);
    let buf = [];
    let bufLen = 0;
    const put = async (str) => { buf.push(str); bufLen += str.length; if (bufLen > 1 << 21) await flush(); };
    const flush = async () => { if (buf.length) await w.write(buf.join('')); buf = []; bufLen = 0; };
    let count = 0;
    let pics = 0;
    const left = [];
    const textRows = restoreRows(lib);
    for (const [i, row] of textRows.entries()) {
      note(`Writing ${i + 1} of ${textRows.length}: ${row.title} (${count.toLocaleString()} messages so far)…`);
      const data = await jsonAt(dir, `${row.folder}/messages.json`);
      if (!data) continue;
      if (!restoreAddrs(data.contact?.people || row.contact?.people, row.title).length) { left.push(row.title); continue; }
      for (const { m, t, sent, group, addrs, from, media } of restoreItems(data, row, withMedia)) {
        const readable = new Date(t).toLocaleString();
        if (!group && !media.length) {
          if (!m.text) continue;
          await put(`  <sms protocol="0" address="${xmlEsc(addrs[0])}" date="${t}" type="${sent ? 2 : 1}" subject="null" body="${xmlEsc(m.text)}" toa="null" sc_toa="null" service_center="null" read="1" status="-1" locked="0" date_sent="${sent ? 0 : t}" sub_id="-1" readable_date="${xmlEsc(readable)}" contact_name="${xmlEsc(row.title)}" />\n`);
          count++;
          continue;
        }
        const files = [];
        for (const x of media) { const file = await fileAt(dir, `${row.folder}/${x.file}`).catch(() => null); if (file) files.push([x, file]); }
        if (!m.text && !files.length) continue;
        await put(`  <mms date="${t}" ct_t="application/vnd.wap.multipart.related" msg_box="${sent ? 2 : 1}" address="${xmlEsc(addrs.join('~'))}" read="1" seen="1" m_type="${sent ? 128 : 132}" sub_id="-1" text_only="${files.length ? 0 : 1}" readable_date="${xmlEsc(readable)}" contact_name="${xmlEsc(row.title)}"><parts>`);
        if (m.text) await put(`<part seq="0" ct="text/plain" name="null" chset="106" cd="null" fn="null" cid="&lt;text0&gt;" cl="text0.txt" ctt_s="null" ctt_t="null" text="${xmlEsc(m.text)}" />`);
        for (const [k2, [x, file]] of files.entries()) {
          const fname = x.file.split('/').pop();
          const ct = MIME[fname.split('.').pop().toLowerCase()] || file.type || 'application/octet-stream';
          await put(`<part seq="0" ct="${ct}" name="${xmlEsc(fname)}" chset="null" cd="null" fn="null" cid="&lt;part${k2}&gt;" cl="${xmlEsc(fname)}" ctt_s="null" ctt_t="null" text="null" data="`);
          await flush();
          await writeBase64(w, file);
          await put('" />');
          pics++;
        }
        // Who it's from (137) and to (151); a sent message is from this phone.
        const addrXml = [`<addr address="${xmlEsc(sent ? 'insert-address-token' : from || addrs[0])}" type="137" charset="106" />`,
          ...addrs.filter((a) => sent || a !== from).map((a) => `<addr address="${xmlEsc(a)}" type="151" charset="106" />`)].join('');
        await put(`</parts><addrs>${addrXml}</addrs></mms>\n`);
        count++;
      }
    }
    await put('</smses>\n');
    await flush();
    await w.write({ type: 'write', position: new TextEncoder().encode(pre).length, data: `${count}"`.padEnd(12) });
    await w.close();
    w = null;
    if (!count) {
      await folder.removeEntry(name).catch(() => {});
      note('Nothing to put in the file: none of the chats has a phone number yet. Back them up again to save their contact cards.');
      return;
    }
    note(`Saved ${count.toLocaleString()} messages${pics ? ` and ${pics.toLocaleString()} photos and videos` : ''} to “restore-to-phone/${name}” in your backup folder.${left.length ? ` Left out (no phone number): ${left.slice(0, 8).join(', ')}${left.length > 8 ? '…' : ''}.` : ''}`);
  } catch (e) {
    if (w) await w.abort().catch(() => {});
    note(e.message);
  } finally {
    $('exportPhone').disabled = $('exportPackage').disabled = false;
  }
};

// The restore package for the Android app (android/): a .tar of the
// photos as files, each chat's messages as JSON lines, and a manifest. Written
// a piece at a time; see GMLib.tarHeader and notes/Restore package.md.
$('exportPackage').onclick = async () => {
  const note = (t) => { $('packageMsg').textContent = t; };
  $('exportPackage').disabled = $('exportPhone').disabled = true;
  let w = null;
  try {
    const dir = await folderForReading();
    const lib = await getLib(true);
    if (!lib.rows?.length) { note('Nothing is backed up yet.'); return; }
    const withMedia = $('phoneMedia').checked;
    const now = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const name = `restore-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.tar`;
    const folder = await dir.getDirectoryHandle('restore-to-phone', { create: true });
    w = await (await folder.getFileHandle(name, { create: true })).createWritable();
    const enc = new TextEncoder();
    const entry = async (path, data) => {
      const size = data instanceof Blob ? data.size : data.length;
      await w.write(GMLib.tarHeader(path, size, now.getTime()));
      await w.write(data);
      const padding = GMLib.tarPadding(size);
      if (padding.length) await w.write(padding);
    };
    const threads = [];
    const counts = { threads: 0, messages: 0, sms: 0, mms: 0, media: 0, media_bytes: 0 };
    const left = [];
    let mediaN = 0;
    const textRows = restoreRows(lib);
    for (const [i, row] of textRows.entries()) {
      note(`Packing ${i + 1} of ${textRows.length}: ${row.title} (${counts.messages.toLocaleString()} messages so far)…`);
      const data = await jsonAt(dir, `${row.folder}/messages.json`);
      if (!data) continue;
      const addrs = restoreAddrs(data.contact?.people || row.contact?.people, row.title);
      if (!addrs.length) { left.push(row.title); continue; }
      const lines = [];
      let first = null;
      let last = null;
      for (const { m, t, sent, group, from, media } of restoreItems(data, row, withMedia)) {
        const parts = [];
        for (const x of media) {
          const file = await fileAt(dir, `${row.folder}/${x.file}`).catch(() => null);
          if (!file) continue;
          const ext = (x.file.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
          const path = `media/${++mediaN}.${ext}`;
          await entry(path, file);
          parts.push({ file: path, ct: MIME[ext] || file.type || 'application/octet-stream', name: x.file.split('/').pop() });
          counts.media++;
          counts.media_bytes += file.size;
        }
        if (!m.text && !parts.length) continue;
        const kind = group || parts.length ? 'mms' : 'sms';
        lines.push(JSON.stringify({ date: t, box: sent ? 2 : 1, kind, addrs, ...(from ? { from } : {}), ...(m.text ? { text: m.text } : {}), ...(parts.length ? { parts } : {}), ...(m.id ? { src_id: m.id } : {}) }));
        counts[kind]++;
        counts.messages++;
        first ??= t;
        last = t;
      }
      if (!lines.length) continue;
      const file = `threads/${String(threads.length + 1).padStart(4, '0')}.ndjson`;
      await entry(file, enc.encode(lines.join('\n') + '\n'));
      threads.push({ file, title: row.title, addresses: addrs, group: addrs.length > 1, messages: lines.length, first, last });
      counts.threads++;
    }
    if (!counts.messages) {
      await w.abort();
      w = null;
      note('Nothing to pack: none of the chats has a phone number yet. Back them up again to save their contact cards.');
      return;
    }
    await entry('manifest.json', enc.encode(JSON.stringify({ format: GMLib.RESTORE_FORMAT, version: GMLib.RESTORE_VERSION, created_at: now.toISOString(), tool: 'Message Archivist', tool_version: chrome.runtime.getManifest().version, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, counts, threads }, null, 2)));
    await w.write(GMLib.tarEnd());
    await w.close();
    w = null;
    const b = counts.media_bytes;
    const size = b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
    note(`Saved “restore-to-phone/${name}”: ${counts.messages.toLocaleString()} messages in ${counts.threads.toLocaleString()} chats${counts.media ? `, ${counts.media.toLocaleString()} photos and videos (${size})` : ''}. Copy it to your phone and open it with the Message Archivist app.${left.length ? ` Left out (no phone number): ${left.slice(0, 8).join(', ')}${left.length > 8 ? '…' : ''}.` : ''}`);
  } catch (e) {
    if (w) await w.abort().catch(() => {});
    note(e.message);
  } finally {
    $('exportPackage').disabled = $('exportPhone').disabled = false;
  }
};

// ---------- deleting a chat from the backup ----------
// Takes one conversation out of your backup. Google Messages and your phone
// aren't touched. Its files are moved into removed-chats/<date>/ in the
// backup folder (so it can still be recovered until that folder is deleted),
// and the index, checksums and log are updated. Optionally it's also left
// out of future backups.

async function moveTree(dir, from, to) {
  // Every file under `from`, moved to the same place under `to`.
  const parts = from.split('/');
  let src = dir;
  for (const p of parts) src = await src.getDirectoryHandle(p);
  const io = libraryIO(dir);
  const moved = [];
  async function walk(d, rel) {
    for await (const [name, h] of d.entries()) {
      const path = rel ? `${rel}/${name}` : name;
      if (h.kind === 'directory') { await walk(h, path); continue; }
      const target = `${to}/${path}`;
      let done = false;
      try {
        // Moving is instant; copying is the fallback where Chrome can't move.
        let dest = dir;
        const tp = target.split('/');
        for (const p of tp.slice(0, -1)) dest = await dest.getDirectoryHandle(p, { create: true });
        if (h.move) { await h.move(dest, tp[tp.length - 1]); done = true; }
      } catch { /* copy instead */ }
      if (!done) {
        try { await io.write(target, await h.getFile()); } catch (e) { if (e.name === 'NotFoundError') continue; throw e; }
      }
      moved.push(`${from}/${path}`);
    }
  }
  await walk(src, '');
  // Then the (now empty, or copied) folder itself.
  let parent = dir;
  for (const p of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(p);
  await parent.removeEntry(parts[parts.length - 1], { recursive: true }).catch((e) => { if (e.name !== 'NotFoundError') throw e; });
  return moved;
}

let deleting = null;
async function askDelete(folder, canAsk = true) {
  try {
    const dir = await folderForReading(canAsk);
    const lib = await libraryRows(dir);
    const row = lib?.rows.find((r) => r.folder === folder);
    if (!row) { toast('That chat isn’t in your backup any more.'); return; }
    // Its folder may already have been deleted by hand (in Finder, say).
    let gone = false;
    try { let d = dir; for (const p of row.folder.split('/')) d = await d.getDirectoryHandle(p); } catch { gone = true; }
    deleting = { dir, lib, row, gone };
    $('delTitle').textContent = `Delete “${row.title}” from your backup?`;
    const where = isText(row) ? 'Google Messages or your phone' : `${GMLib.serviceLabel(GMLib.serviceOf(row))} or its export`;
    noteAccounts((await getLib()).rows);
    $('delText').textContent = gone
      ? `Its folder (${row.folder}) is already gone from your backup folder, so this just takes the chat off your backup’s list, index and checksums. It doesn’t touch ${where}.`
      : `This takes the chat out of your backup: ${(row.count || 0).toLocaleString()} messages and ${(row.media_saved || 0).toLocaleString()} photos and videos. It doesn’t touch ${where}. The files are moved into a folder called “removed-chats” inside your backup folder, so you can still get them back until you delete that folder.`;
    // "Don't back it up again" is about Google Messages: text chats only.
    $('delExclude').closest('.check').hidden = !isLive(row);
    $('delExclude').checked = isLive(row);
    $('delMsg').textContent = '';
    $('delGo').disabled = false;
    $('deleteDlg').showModal();
  } catch (e) {
    toast(canAsk ? e.message : 'Chrome needs your OK for the backup folder first: click “Allow access” under Your backups, then use Delete… in Check for problems.');
  }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-delete]');
  if (b) { e.stopPropagation(); askDelete(b.dataset.delete); }
});
$('delCancel').onclick = () => $('deleteDlg').close();
$('delGo').onclick = async () => {
  const { dir, lib, row, gone } = deleting || {};
  if (!row) return;
  $('delGo').disabled = true;
  const say = (t) => { $('delMsg').textContent = t; };
  try {
    // A backup running now would put the chat back when it saves its index.
    const ping = await chrome.runtime.sendMessage({ type: 'gm-to-tab', focus: false, message: { type: 'gm-ping' } }).catch(() => null);
    if (ping?.running) { say('A backup is running in the Google Messages tab. Stop it (or let it finish) first, then delete.'); $('delGo').disabled = false; return; }
    const started = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const dest = `removed-chats/${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())} ${pad(started.getHours())}.${pad(started.getMinutes())}`;
    let removed = [];
    if (!gone) {
      say('Moving its files…');
      removed = await moveTree(dir, row.folder, `${dest}/${row.folder.split('/').pop()}`);
    }
    const io = libraryIO(dir);
    const rows = lib.rows.filter((r) => r !== row);
    const exclude = $('delExclude').checked && row.id;
    if (exclude) {
      const state = lib.state || {};
      state.excluded = [...(state.excluded || []).filter((x) => x.id !== row.id), { id: row.id, title: row.title, at: started.toISOString() }];
      await io.write('backup-state.json', JSON.stringify(state, null, 2));
    }
    const s = await getSettings();
    if (row.id) await saveSettings({ schedules: s.schedules.filter((j) => j.id !== row.id) });
    const { chatStatus = {} } = await chrome.storage.local.get('chatStatus');
    if (row.id && chatStatus[row.id]) { delete chatStatus[row.id]; await chrome.storage.local.set({ chatStatus }); }
    const summary = `Deleted “${row.title}” from the backup (${(row.count || 0).toLocaleString()} messages${gone ? '; its folder had already been removed' : `, ${removed.length.toLocaleString()} files, moved into “${dest}”`}).${exclude ? ' It won’t be backed up again unless you back it up yourself.' : ''}`;
    const lines = [`[${started.toISOString()}] ${summary}`];
    say('Updating the backup’s index and checksums…');
    await finishLibraryRun(io, rows, lib.exp, { kind: 'delete chat', started_at: started.toISOString(), chats: [row.title], ...(gone ? { folder_already_gone: true } : { moved_to: dest, files: removed.length }) }, lines, summary, { target: row.title, removed, removedFolder: row.folder });
    $('deleteDlg').close();
    toast(`“${row.title}” was deleted from your backup.`);
    deleting = null;
    libCache = null;
    refreshTab();
  } catch (err) {
    say(`Couldn’t finish: ${err.message.replace(/\.+$/, '')}. Anything already moved is in the removed-chats folder, and you can try again.`);
    $('delGo').disabled = false;
  }
};
// "Delete from backup" in the viewer opens Settings at that chat.
if (location.hash.startsWith('#delete:')) {
  const folder = decodeURIComponent(location.hash.slice(8));
  routed = true;
  showTab('backups');
  askDelete(folder, false);
}

// ---------- leaving codes, promotions and automated texts out ----------
// Settings → Leave out of your archive (skipCodes, skipPromos, skipAutomated;
// GMLib.chatKind). "Back up everything" (content.js) and imports
// (importChat) skip them; this finds the ones already in the archive and
// moves them out as Delete does: into removed-chats/<date>/, and onto
// backup-state.json's excluded list with the reason, so "Back up everything"
// doesn't bring them back.
let skippable = null;
$('skipFind').onclick = async () => {
  const msg = $('skipMsg');
  $('skipFound').innerHTML = '';
  skippable = null;
  try {
    const skip = GMLib.skipKinds(await getSettings());
    if (!skip.size) { msg.textContent = 'Tick what to leave out first.'; return; }
    const dir = await folderForReading();
    const lib = await libraryRows(dir);
    if (!lib?.rows.length) { msg.textContent = 'There’s nothing in your archive yet.'; return; }
    const labels = await jsonAt(dir, 'labels.json');
    const found = [];
    for (const [i, row] of lib.rows.entries()) {
      if (i % 20 === 0) msg.textContent = `Looking through your chats: ${i.toLocaleString()} of ${lib.rows.length.toLocaleString()}…`;
      if (GMLib.senderOf(row) === 'group') continue;
      // Traits missing (a row from before the index kept them) or counted by older
      // rules: worked out from the chat itself (and kept on the row, so the index
      // has them once it's next written).
      const traits = GMLib.traitsCurrent(row.traits) ? row.traits : (row.traits = GMLib.chatTraits((await jsonAt(dir, `${row.folder}/messages.json`))?.messages));
      const kind = GMLib.chatKindFor(row, labels, traits);
      if (kind && skip.has(kind)) found.push({ row, kind });
    }
    if (!found.length) { msg.textContent = `None found: nothing in your archive is ${[...skip].map((k) => GMLib.CHAT_KINDS[k].toLowerCase()).join(' or ')}.`; return; }
    skippable = { dir, lib, found };
    const of = (k) => found.filter((f) => f.kind === k).length;
    const messages = found.reduce((n, f) => n + (f.row.count || 0), 0);
    msg.textContent = `Found ${found.length.toLocaleString()} chat${found.length === 1 ? '' : 's'} (${messages.toLocaleString()} messages): ${Object.keys(GMLib.CHAT_KINDS).filter(of).map((k) => `${GMLib.CHAT_KINDS[k].toLowerCase()} ${of(k).toLocaleString()}`).join(', ')}.`;
    $('skipFound').innerHTML = `<details style="margin:6px 0"><summary class="secondary">Which chats</summary><ul class="secondary" style="margin:6px 0 0 18px;padding:0;max-height:240px;overflow:auto">${found.map((f) => `<li>${esc(GMLib.formatNumber(f.row.title))} · ${esc(GMLib.CHAT_KINDS[f.kind])} · ${(f.row.count || 0).toLocaleString()} message${f.row.count === 1 ? '' : 's'}</li>`).join('')}</ul></details>
      <div class="row"><button id="skipGo" class="tonal small">Move them out of my archive</button><span class="secondary">They go into the removed-chats folder (delete that to remove them for good), and “Back up everything” leaves them out from now on.</span></div>`;
  } catch (e) {
    msg.textContent = e.message;
  }
};
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'skipGo' || !skippable) return;
  const { dir, lib, found } = skippable;
  const msg = $('skipMsg');
  e.target.disabled = true;
  try {
    // A backup running now would put them back when it saves its index.
    const ping = await chrome.runtime.sendMessage({ type: 'gm-to-tab', focus: false, message: { type: 'gm-ping' } }).catch(() => null);
    if (ping?.running) { msg.textContent = 'A backup is running in the Google Messages tab. Stop it (or let it finish) first, then try again.'; e.target.disabled = false; return; }
    const started = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const dest = `removed-chats/${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())} ${pad(started.getHours())}.${pad(started.getMinutes())}`;
    const removed = [];
    for (const [i, { row }] of found.entries()) {
      msg.textContent = `Moving ${(i + 1).toLocaleString()} of ${found.length.toLocaleString()}: ${GMLib.formatNumber(row.title)}…`;
      try { removed.push(...(await moveTree(dir, row.folder, `${dest}/${row.folder.replace(/^conversations\//, '')}`))); } catch (err) { if (err.name !== 'NotFoundError') throw err; }
    }
    const io = libraryIO(dir);
    const gone = new Set(found.map((f) => f.row));
    const ids = new Set(found.map((f) => f.row.id).filter(Boolean));
    const state = lib.state || {};
    state.excluded = [...(state.excluded || []).filter((x) => !ids.has(x.id)), ...found.filter((f) => f.row.id).map((f) => ({ id: f.row.id, title: f.row.title, at: started.toISOString(), reason: f.kind }))];
    await io.write('backup-state.json', JSON.stringify(state, null, 2));
    const s = await getSettings();
    await saveSettings({ schedules: s.schedules.filter((j) => !ids.has(j.id)) });
    const kinds = [...new Set(found.map((f) => GMLib.CHAT_KINDS[f.kind].toLowerCase()))].join(', ');
    const summary = `Moved ${found.length.toLocaleString()} chat${found.length === 1 ? '' : 's'} of ${kinds} out of the archive (${removed.length.toLocaleString()} files, into “${dest}”).`;
    msg.textContent = 'Updating the archive’s index and checksums…';
    await finishLibraryRun(io, lib.rows.filter((r) => !gone.has(r)), lib.exp, { kind: 'leave out', started_at: started.toISOString(), chats: found.map((f) => f.row.title), moved_to: dest, files: removed.length },
      [`[${started.toISOString()}] ${summary}`, ...found.map((f) => `– ${f.row.title}: ${GMLib.CHAT_KINDS[f.kind].toLowerCase()}`)], summary, { target: kinds, removed });
    msg.textContent = summary;
    $('skipFound').innerHTML = '';
    skippable = null;
    libCache = null;
    refreshTab();
  } catch (err) {
    msg.textContent = `Couldn’t finish: ${err.message.replace(/\.+$/, '')}. Anything already moved is in the removed-chats folder; find them again to carry on.`;
    e.target.disabled = false;
  }
});

// ---------- duplicate photos ----------
// Earlier versions sometimes saved a picture twice in one message: a GIF and
// its still preview, or a thumbnail beside the full-size photo. This finds
// them by what the pictures look like (never two different photos), plus
// leftover files in a chat's media folder that are exact copies of one in
// use. Nothing is deleted: the extra copies are moved into
// removed-duplicates/<date>/, to look through and then delete.

let dupes = null;

async function removeAt(dir, path) {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
  await d.removeEntry(parts[parts.length - 1]);
}

const mb = (b) => b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`;

$('findDupes').onclick = async () => {
  $('health').innerHTML = '';
  dupes = null;
  try {
    const dir = await folderForReading();
    const lib = await libraryRows(dir);
    if (!lib) { $('healthMsg').textContent = `“${dir.name}” has no backups yet.`; return; }
    const found = [];
    let n = 0;
    for (const row of lib.rows) {
      $('healthMsg').textContent = `Looking through ${++n} of ${lib.rows.length}: ${row.title}…`;
      const data = await jsonAt(dir, `${row.folder}/messages.json`);
      if (!data) continue;
      const chat = { row, data, drops: [], leftovers: [], bytes: 0 };
      const usedPaths = new Set();
      const usedSha = new Set();
      for (const m of data.messages) for (const md of m.media || []) if (md.file) { usedPaths.add(md.file); if (md.sha256) usedSha.add(md.sha256); }
      // Two copies of a picture in one message.
      for (const [mi, m] of data.messages.entries()) {
        const pics = (m.media || []).map((md, k) => ({ md, k })).filter((x) => x.md.file && /^(image|gif|preview)$/.test(x.md.kind));
        if (pics.length < 2) continue;
        for (const x of pics) {
          const file = await fileAt(dir, `${row.folder}/${x.md.file}`).catch(() => null);
          if (!file) continue;
          x.fp = await GMLib.imageFingerprint(file);
          x.cmp = { gif: x.md.kind === 'gif' || file.type === 'image/gif', w: x.fp?.w || x.md.width, h: x.fp?.h || x.md.height, size: file.size };
        }
        for (let i = 0; i < pics.length; i++) {
          for (let j = i + 1; j < pics.length; j++) {
            const [a, b] = [pics[i], pics[j]];
            if (!a.cmp || !b.cmp || a.gone || b.gone) continue;
            const exact = a.md.sha256 && a.md.sha256 === b.md.sha256;
            if (!exact && !GMLib.sameImage(a.fp, b.fp)) continue;
            const keep = GMLib.betterCopy(a.cmp, b.cmp) === a.cmp ? a : b;
            const drop = keep === a ? b : a;
            drop.gone = true;
            chat.drops.push({ mi, k: drop.k, file: drop.md.file, keep: keep.md.file, size: drop.cmp.size });
            chat.bytes += drop.cmp.size;
          }
        }
      }
      // Files in the media folder no message uses, that are exact copies of one in use.
      try {
        let media = dir;
        for (const p of `${row.folder}/media`.split('/')) media = await media.getDirectoryHandle(p);
        for await (const [name, h] of media.entries()) {
          if (h.kind !== 'file' || usedPaths.has(`media/${name}`)) continue;
          const file = await h.getFile();
          if (usedSha.has(await GMLib.sha256(file))) { chat.leftovers.push({ file: `media/${name}`, size: file.size }); chat.bytes += file.size; }
        }
      } catch { /* no media folder */ }
      if (chat.drops.length || chat.leftovers.length) found.push(chat);
    }
    $('healthMsg').textContent = '';
    if (!found.length) {
      $('health').innerHTML = '<div class="health-summary"><span class="pill-status ok">No duplicates</span> No photo is saved twice in your backup.</div>';
      return;
    }
    dupes = { dir, lib, found };
    const count = found.reduce((t, c) => t + c.drops.length + c.leftovers.length, 0);
    const bytes = found.reduce((t, c) => t + c.bytes, 0);
    $('health').innerHTML = `<div class="health-summary"><b>${count.toLocaleString()} extra cop${count === 1 ? 'y' : 'ies'} of photos (${mb(bytes)}) in ${found.length} chat${found.length === 1 ? '' : 's'}.</b>
      These are pictures saved twice: a GIF and its still picture, a small thumbnail beside the full-size photo, or a leftover file identical to one in use. The best copy of each picture stays where it is.
      <div class="row" style="margin-top:8px"><button id="fixDupes" class="filled small">Move the extra copies out</button></div>
      <div class="secondary" style="margin-top:6px">Nothing is deleted: they’re moved into a folder called “removed-duplicates” inside your backup folder, so you can look through them first and delete that folder when you’re happy.</div></div>
      <table><tr><th>Chat</th><th class="num">Extra copies</th><th class="num">Space</th></tr>
      ${found.map((c) => `<tr><td>${esc(c.row.title)}</td><td class="num">${(c.drops.length + c.leftovers.length).toLocaleString()}</td><td class="num">${mb(c.bytes)}</td></tr>`).join('')}</table>`;
  } catch (e) {
    $('healthMsg').textContent = e.message;
  }
};

document.addEventListener('click', async (e) => {
  if (e.target.id !== 'fixDupes' || !dupes) return;
  e.target.disabled = true;
  const { dir, lib, found } = dupes;
  const lines = [];
  const log = (t) => lines.push(`[${new Date().toISOString()}] ${t}`);
  try {
    const io = libraryIO(dir);
    const started = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const base = `removed-duplicates/${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())} ${pad(started.getHours())}.${pad(started.getMinutes())}`;
    const rows = [...lib.rows];
    const removed = [];
    let moved = 0;
    let bytes = 0;
    for (const chat of found) {
      $('healthMsg').textContent = `Tidying ${chat.row.title}…`;
      const { row, data } = chat;
      // Take the extra copies out of their messages, noting how many each lost.
      const byMsg = new Map();
      for (const d of chat.drops) byMsg.set(d.mi, [...(byMsg.get(d.mi) || []), d]);
      for (const [mi, list] of byMsg) {
        const m = data.messages[mi];
        const gone = new Set(list.map((d) => d.k));
        m.media = m.media.filter((_, k) => !gone.has(k));
        m.duplicates_removed = (m.duplicates_removed || 0) + list.length;
        for (const d of list) log(`${row.title}: ${m.timestamp || 'undated'}, ${m.sender}: moved ${d.file} (kept ${d.keep})`);
      }
      for (const l of chat.leftovers) log(`${row.title}: moved leftover ${l.file} (an exact copy of a photo in use)`);
      // Move the files: copy into removed-duplicates, then remove the original.
      for (const f of [...chat.drops, ...chat.leftovers]) {
        const path = `${row.folder}/${f.file}`;
        const file = await fileAt(dir, path);
        await io.write(`${base}/${path}`, file);
        await removeAt(dir, path);
        removed.push(path);
        moved++;
        bytes += f.size;
      }
      const media = data.messages.flatMap((m) => m.media || []);
      data.media_count = media.filter((x) => x.file).length;
      data.updated_at = new Date().toISOString();
      let progress = null;
      try { progress = JSON.parse((await io.readText(`${row.folder}/progress.json`)) || 'null'); } catch { /* none */ }
      if (progress) {
        progress.checks = GMLib.checkChat(data.messages, progress, data.contact);
        await io.write(`${row.folder}/progress.json`, JSON.stringify(progress, null, 2));
      }
      await io.write(`${row.folder}/messages.json`, JSON.stringify(data));
      await io.write(`${row.folder}/chat.js`, GMLib.chatScript(row.folder, GMLib.compactMessages(row.folder, data.messages)));
      await io.write(`${row.folder}/messages.csv`, GMLib.chatCsv(row.title, row.folder, data.messages));
      rows[rows.indexOf(row)] = GMLib.summarize({ id: row.id, title: row.title, folder: row.folder, data, progress });
    }
    const summary = `Moved ${moved.toLocaleString()} extra cop${moved === 1 ? 'y' : 'ies'} of photos (${mb(bytes)}) into “${base}” in your backup folder. Look through them if you like, then delete that folder.`;
    log(summary);
    await finishLibraryRun(io, rows, lib.exp, { kind: 'clean up duplicates', started_at: started.toISOString(), chats: found.map((c) => c.row.title), moved, moved_to: base }, lines, summary, { target: `${found.length} chats`, removed });
    $('healthMsg').textContent = '';
    $('health').innerHTML = `<div class="health-summary"><span class="pill-status ok">Done</span> ${esc(summary)}</div>`;
    dupes = null;
    libCache = null;
  } catch (err) {
    $('healthMsg').textContent = `Stopped: ${err.message}. Nothing already moved is lost; it’s in the removed-duplicates folder.`;
    e.target.disabled = false;
  }
});

// ---------- import earlier exports ----------
// Exports saved by earlier versions (folders or zips) join the library. Each
// chat goes into its folder here, matched by Google's conversation ID (or its
// name), and only gets the messages and media it doesn't have yet. A chat new
// to the library is marked as not yet read from Messages, so its next backup
// reads the whole chat again to make sure nothing older is missing.

// An export found inside a picked folder or zip: its chat folders, and
// read(path) for files relative to its root.
function zipExports(zip, label) {
  const byRoot = new Map();
  for (const n of zip.names) {
    const m = n.match(/^((?:[^/]+\/){0,3}?)(conversations\/(?:[^/]+\/)?[^/]+)\/messages\.json$/);
    if (!m) continue;
    if (!byRoot.has(m[1])) byRoot.set(m[1], []);
    byRoot.get(m[1]).push(m[2]);
  }
  return [...byRoot].map(([root, chats]) => ({ name: `${label}${root ? ` › ${root.replace(/\/$/, '')}` : ''}`, chats, read: (p) => zip.blob(root + p) }));
}

async function findExports(dir, note) {
  const found = [];
  async function walk(d, label, depth) {
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') {
        if (name === 'conversations') {
          const chats = [];
          for await (const [n, c] of h.entries()) {
            if (c.kind !== 'directory') continue;
            try { await c.getFileHandle('messages.json'); chats.push(`conversations/${n}`); } catch {
              // Another app's folder (conversations/<App>/<chat>/).
              for await (const [n2, c2] of c.entries()) {
                if (c2.kind !== 'directory') continue;
                try { await c2.getFileHandle('messages.json'); chats.push(`conversations/${n}/${n2}`); } catch { /* not a chat */ }
              }
            }
          }
          if (chats.length) found.push({ name: label, chats, read: async (p) => { try { return await fileAt(d, p); } catch { return null; } } });
        } else if (depth < 3 && !/^(media|contact|logs|\..*)$/.test(name)) {
          await walk(h, `${label}/${name}`, depth + 1);
        }
      } else if (/\.zip$/i.test(name) && depth < 4) {
        note(`Reading ${name}…`);
        try { found.push(...zipExports(await GMZip.open(await h.getFile()), `${label}/${name}`)); } catch (e) { found.problems = [...(found.problems || []), e.message]; }
      }
    }
  }
  await walk(dir, dir.name, 0);
  return found;
}

// Reads and writes the library through its folder handle, keeping the
// SHA-256 of everything written for SHA256SUMS.txt.
function libraryIO(dir) {
  const hashes = new Map();
  return {
    dir,
    hashes,
    readText: (p) => textAt(dir, p),
    exists: async (p) => { try { await fileAt(dir, p); return true; } catch { return false; } },
    async write(path, data) {
      const parts = path.split('/');
      let d = dir;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
      hashes.set(path, await GMLib.sha256(data));
      const w = await (await d.getFileHandle(parts[parts.length - 1], { create: true })).createWritable();
      await w.write(data);
      await w.close();
    },
    async remove(path) {
      const parts = path.split('/');
      let d = dir;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
      await d.removeEntry(parts[parts.length - 1]).catch((e) => { if (e.name !== 'NotFoundError') throw e; });
    },
  };
}

// ---------- Obsidian ----------
// The archive as Obsidian notes (obsidian.js), in Obsidian/ in the backup
// folder: written here on request, and after every backup and import when
// "Keep them up to date" is on. Notes aren't part of the checksums.
async function updateObsidian(dir, rows, onProgress) {
  return GMObsidian.update(libraryIO(dir), { rows, saved: await jsonAt(dir, 'people.json'), labels: await jsonAt(dir, 'labels.json'), book: await jsonAt(dir, 'contacts.json'), onProgress });
}
async function renderObsidian(say = true) {
  try {
    const st = await GMObsidian.status(libraryIO(await folderForReading(false)));
    $('obsidianWrite').textContent = st ? 'Update the notes' : 'Write the notes';
    $('obsidianDelete').hidden = !st;
    if (st && say && !$('obsidianWrite').disabled) $('obsidianMsg').textContent = `${st.notes.toLocaleString()} notes, last written ${when(Date.parse(st.updated_at))}.`;
  } catch { /* no folder, or no access yet: nothing to say */ }
}
async function writeObsidian() {
  const btn = $('obsidianWrite');
  const msg = $('obsidianMsg');
  btn.disabled = true;
  try {
    const dir = await folderForReading();
    const lib = await libraryRows(dir);
    if (!lib?.rows.length) throw new Error('There’s nothing in your backup yet.');
    msg.textContent = 'Reading your backup…';
    const r = await updateObsidian(dir, lib.rows, (n, total) => { msg.textContent = `Writing notes: ${n.toLocaleString()} of ${total.toLocaleString()} chats…`; });
    msg.innerHTML = `${r.written ? `Wrote ${r.written.toLocaleString()} notes` : 'Every note was already up to date'} (${r.notes.toLocaleString()} in all, for ${r.people.toLocaleString()} people${r.topics ? `, ${r.topics.toLocaleString()} topics` : ''}${r.events ? ` and ${r.events.toLocaleString()} events` : ''})${r.removed ? `; removed ${r.removed.toLocaleString()} no longer needed` : ''}${r.kept ? `; left ${r.kept.toLocaleString()} you’ve written in as they are` : ''}. In Obsidian: <b>Open folder as vault</b>, then pick “${esc(dir.name)}”.${r.suggestions ? ` ${r.suggestions.toLocaleString()} people may be the same as someone else: see People in <a href="#" id="obsidianPeople">your backup</a>.` : ''}`;
  } catch (e) {
    msg.textContent = e.message;
  } finally {
    btn.disabled = false;
    renderObsidian(false);
  }
}
$('obsidianWrite').onclick = () => writeObsidian();

// Deleting the notes: the whole Obsidian folder, for good, in two steps.
// First what goes (counting the notes the owner wrote in, and files of their
// own in the folder), then a last, plainer warning. Not moved anywhere:
// they're derived, so "Write the notes" makes them again, but not the
// owner's own writing.
let obsDeleting = null;
async function obsidianFiles(dir) {
  const files = [];
  async function walk(d, at) {
    for await (const [name, h] of d.entries()) {
      if (h.kind === 'directory') await walk(h, `${at}/${name}`);
      else files.push(`${at}/${name}`);
    }
  }
  await walk(await dir.getDirectoryHandle(GMObsidian.ROOT), GMObsidian.ROOT);
  return files;
}
$('obsidianDelete').onclick = async () => {
  const say = (t) => { $('obsDlgMsg').textContent = t; };
  $('obsDlgTitle').textContent = 'Delete your Obsidian notes?';
  $('obsDlgText').textContent = 'Looking at what’s in the Obsidian folder…';
  $('obsNext').hidden = false;
  $('obsNext').disabled = true;
  $('obsGo').hidden = true;
  say('');
  $('obsidianDlg').showModal();
  try {
    const dir = await folderForReading();
    const io = libraryIO(dir);
    const ours = new Set(Object.keys(JSON.parse((await io.readText(GMObsidian.MANIFEST)) || '{}').files || {}));
    const files = await obsidianFiles(dir);
    const extra = files.filter((p) => !ours.has(p) && p !== GMObsidian.MANIFEST).length;
    let yours = 0;
    const check = files.filter((p) => ours.has(p) && GMObsidian.ownable(p));
    for (const [i, p] of check.entries()) {
      if (i % 200 === 0) say(`Checking for notes you’ve written in: ${i.toLocaleString()} of ${check.length.toLocaleString()}…`);
      if (GMObsidian.hasYours(await io.readText(p))) yours++;
    }
    say('');
    obsDeleting = { dir };
    const n = (x, one, many) => `${x.toLocaleString()} ${x === 1 ? one : many}`;
    $('obsDlgText').innerHTML = `This deletes the whole <b>Obsidian</b> folder in “${esc(dir.name)}”: ${n(files.length, 'file', 'files')}${yours ? `, including <b>${n(yours, 'note you’ve written in', 'notes you’ve written in')}</b>` : ''}${extra ? ` and <b>${n(extra, 'file of your own', 'files of your own')}</b> you put there` : ''}. They aren’t moved anywhere, so it can’t be undone.<br><br>Your messages, photos and the rest of your backup aren’t touched. To have the notes again you’ll need to write them again (<b>Write the notes</b>), which takes a while on a big archive${yours || extra ? ', and what you wrote yourself won’t come back' : ''}. “Keep them up to date” is turned off, so a backup doesn’t write them again by itself.<span class="app-only"> The extension’s Settings has its own switch: turn it off there too, or its next backup writes them again.</span>`;
    $('obsNext').disabled = false;
    $('obsNext').focus();
  } catch (e) {
    $('obsDlgText').textContent = e.name === 'NotFoundError' ? 'There’s no Obsidian folder in your backup folder: nothing to delete.' : `Couldn’t look at the notes: ${e.message}`;
    if (e.name === 'NotFoundError') renderObsidian(false);
  }
};
$('obsNext').onclick = () => {
  $('obsDlgTitle').textContent = 'Delete them for good?';
  $('obsDlgText').innerHTML = 'This is the last step. <b>The Obsidian folder and everything in it will be deleted and can’t be recovered.</b> You’ll need to write the notes again to have them back.';
  $('obsNext').hidden = true;
  $('obsGo').hidden = false;
  $('obsGo').disabled = false;
  $('obsCancel').focus();
};
$('obsCancel').onclick = () => { obsDeleting = null; $('obsidianDlg').close(); };
$('obsGo').onclick = async () => {
  const { dir } = obsDeleting || {};
  if (!dir) return;
  $('obsGo').disabled = true;
  $('obsDlgMsg').textContent = 'Deleting…';
  try {
    // A backup finishing now would write them again.
    const ping = await chrome.runtime.sendMessage({ type: 'gm-to-tab', focus: false, message: { type: 'gm-ping' } }).catch(() => null);
    if (ping?.running) { $('obsDlgMsg').textContent = 'A backup is running in the Google Messages tab. Let it finish (or stop it) first, then delete.'; $('obsGo').disabled = false; return; }
    await saveSettings({ obsidian: false });
    $('obsidian').checked = false;
    await dir.removeEntry(GMObsidian.ROOT, { recursive: true }).catch((e) => { if (e.name !== 'NotFoundError') throw e; });
    obsDeleting = null;
    $('obsidianDlg').close();
    $('obsidianMsg').textContent = 'The Obsidian notes were deleted. Write the notes to have them again.';
    toast('Obsidian notes deleted.');
  } catch (e) {
    $('obsDlgMsg').textContent = `Couldn’t delete them: ${e.message.replace(/\.+$/, '')}. Some may be gone already; try again, or delete the Obsidian folder yourself.`;
    $('obsGo').disabled = false;
  } finally {
    renderObsidian(false);
  }
};
$('obsidianMsg').addEventListener('click', (e) => {
  if (e.target.id !== 'obsidianPeople') return;
  e.preventDefault();
  openArchive('people/~matches');
});

// A phone backup from the Android app as an import source: its chats come
// out as library chats (GMLib.phoneChat), and a chat's photos are read
// straight from the package.
async function phoneSource(file) {
  const pkg = await GMLib.readPackage(file);
  const threads = new Map(pkg.manifest.threads.map((t) => [t.file.replace(/\.ndjson(\.gz)?$/, ''), t]));
  const files = new Map(); // chat -> (photo name -> package entry)
  const own = pkg.manifest.owner?.number;
  return {
    name: file.name,
    phone: true,
    manifest: pkg.manifest,
    pkg, // the package itself: other apps' exports in it (sourcesFrom)
    owner: own ? { id: own, label: GMLib.formatNumber(own) } : null,
    chats: [...threads.keys()],
    // The phone's address book, when the app saved every contact (an empty
    // one once that's turned off): { captured_at, contacts }.
    async book() {
      const a = pkg.manifest.address_book;
      const b = a?.file && pkg.entry(a.file);
      if (!b) return null;
      try {
        const j = JSON.parse(await new Response(b.stream().pipeThrough(new DecompressionStream('gzip'))).text());
        return j?.format === 'gm-address-book' && Array.isArray(j.contacts) ? j : null;
      } catch { return null; }
    },
    thread: (chatPath) => threads.get(chatPath),
    async read(path) {
      const [, chatPath, rest] = path.match(/^(threads\/[^/]+)\/(.+)$/) || [];
      const t = threads.get(chatPath);
      if (!t) return null;
      if (rest === 'messages.json') {
        const { data, files: f } = GMLib.phoneChat(t, await pkg.threadLines(t), pkg.size, pkg.manifest.created_at);
        files.set(chatPath, f);
        return new Blob([JSON.stringify(data)]);
      }
      const entry = files.get(chatPath)?.get(rest);
      return entry ? pkg.entry(entry) : null;
    },
  };
}

async function importChat(io, rows, src, chatPath, data, report, log) {
  const title = data.conversation || chatPath.split('/').pop();
  // A chat only ever joins one from the same app: a WhatsApp chat with Alice
  // and the text chat with Alice stay two chats.
  const service = data.service || src.service || 'sms';
  // ...and of the same account: a second number's texts never join the first's.
  const account = src.accountChoice || null; // null: the app's main account
  const same = rows.filter((r) => GMLib.serviceOf(r) === service && GMLib.sameAccount(r.account, account?.id));
  const row = src.phone ? GMLib.phoneRowFor(same, src.thread(chatPath))
    : same.find((r) => r.id && data.conversation_id && r.id === data.conversation_id) || same.find((r) => (!r.id || !data.conversation_id) && r.title === title);
  const fromApp = service !== 'sms' && src.importer;
  let folder;
  let libData = null;
  let progress = null;
  if (row) {
    folder = row.folder;
    try { libData = JSON.parse((await io.readText(`${folder}/messages.json`)) || 'null'); } catch { /* start it again */ }
    try { progress = JSON.parse((await io.readText(`${folder}/progress.json`)) || 'null'); } catch { /* none */ }
  } else {
    const base = GMLib.chatFolder(service, title, account);
    for (let n = 1; ; n++) {
      folder = n === 1 ? base : `${base} (${n})`;
      if (!rows.some((r) => r.folder.toLowerCase() === folder.toLowerCase()) && !(await io.exists(`${folder}/messages.json`))) break;
    }
  }
  // Left out (Settings): judged on everything the chat would hold, with the
  // owner's labels on the chat it would join.
  if (report.skip?.size) {
    const probe = { id: row?.id || data.conversation_id, folder: row?.folder, title, service, group: data.group ?? row?.group, contact: data.contact || row?.contact };
    const kind = GMLib.chatKindFor(probe, report.labels, GMLib.chatTraits([...(libData?.messages || []), ...(data.messages || [])]));
    if (kind && report.skip.has(kind)) {
      report.left[kind] = (report.left[kind] || 0) + 1;
      log(`– ${title}: left out (${GMLib.CHAT_KINDS[kind].toLowerCase()})`);
      return row || null;
    }
  }
  let saved = libData?.messages || [];
  const incoming = data.messages || [];
  if (src.phone && row) GMLib.useLibraryNames(incoming, row);
  const used = new Set();
  // Copies one media file in, keeping its name where it's free and checking
  // its checksum against the one the export recorded.
  const copyIn = async (md) => {
    const blob = await src.read(`${chatPath}/${md.file}`);
    if (!blob) { report.missing++; md.file = null; md.error = 'missing from the imported export'; return false; }
    const sha = await GMLib.sha256(blob);
    if (md.sha256 && md.sha256 !== sha) { report.mismatch++; log(`! ${title}: ${md.file} doesn’t match the checksum its export recorded`); }
    const name = md.file.split('/').pop();
    const dot = name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
    let dest;
    for (let n = 1; ; n++) {
      dest = `media/${stem}${n > 1 ? ` (${n})` : ''}${ext}`;
      if (!used.has(dest) && !(await io.exists(`${folder}/${dest}`))) break;
    }
    used.add(dest);
    await io.write(`${folder}/${dest}`, blob);
    md.file = dest;
    md.sha256 = sha;
    delete md.error;
    report.media++;
    return true;
  };

  const fresh = (src.phone ? GMLib.unknownPhone : GMLib.unknownIn)(saved, incoming).map((m) => ({ ...m, media: (m.media || []).map((md) => ({ ...md })) }));
  for (const m of fresh) for (const md of m.media) if (md.file) await copyIn(md);
  // Photos the library is missing for messages it already has. From a phone
  // backup (one made without photos, then updated with them, say), the same
  // message is the one with the same phone message number and exact time.
  let filled = 0;
  const phoneKey = (m) => m.phone_id && m.timestamp_raw ? `${m.phone_id}|${m.timestamp_raw}` : null;
  const theirKey = src.phone ? phoneKey : GMLib.keyOf;
  const theirs = new Map(incoming.map((m) => [theirKey(m), m]));
  theirs.delete(null);
  for (const r of saved) {
    const other = theirs.get(theirKey(r));
    for (const [i, md] of (r.media || []).entries()) {
      const o = other?.media?.[i];
      if (md.file || !o?.file || o.kind !== md.kind) continue;
      const c = { ...o };
      if (await copyIn(c)) { Object.assign(md, { file: c.file, sha256: c.sha256, width: c.width, height: c.height, source: c.source }); delete md.error; filled++; }
    }
  }
  let contact = libData?.contact || null;
  if (!contact && data.contact?.people) {
    contact = { ...data.contact, people: [] };
    for (const p of data.contact.people) {
      let photo = null;
      if (p.photo) {
        const blob = await src.read(`${chatPath}/${p.photo}`);
        if (blob) { photo = p.photo; await io.write(`${folder}/${photo}`, blob); }
      }
      contact.people.push({ ...p, photo });
    }
    await io.write(`${folder}/contact.json`, JSON.stringify(contact, null, 2));
  } else if (contact && src.phone && data.contact?.people) {
    // The library's card, with what the phone adds: who's a favourite (starred
    // in its contacts), photos the card doesn't have, and the rest of the
    // phone's contact (`card`).
    const theirs = new Map(data.contact.people.map((p) => [GMLib.phoneKey(p.number), p]));
    let changed = false;
    const people = [];
    for (const p of contact.people) {
      const o = theirs.get(GMLib.phoneKey(p.number));
      const q = { ...p };
      if (o?.favorite && !p.favorite) { q.favorite = true; changed = true; }
      // The rest of the phone's contact, as the phone has it now.
      if (o?.card && JSON.stringify(o.card) !== JSON.stringify(p.card)) { q.card = o.card; changed = true; }
      if (o?.photo && !p.photo) {
        const blob = await src.read(`${chatPath}/${o.photo}`);
        if (blob) { q.photo = o.photo; await io.write(`${folder}/${o.photo}`, blob); changed = true; }
      }
      people.push(q);
    }
    if (changed) { contact = { ...contact, people }; await io.write(`${folder}/contact.json`, JSON.stringify(contact, null, 2)); }
  }
  report.skipped += incoming.length - fresh.length;
  // How far the chat's history is known to go. A phone backup has the whole
  // chat as the phone did ("From phone"); an export says in its own
  // progress.json; otherwise it's unknown until it's read from Messages.
  let known = progress;
  if (fromApp) {
    // Another app's export: the chat as that export had it ("Imported"),
    // or only part of it (Discord's package has only your own messages).
    const partial = data.partial || src.partial || null;
    known = { ...(known || {}), complete: false, history_complete: false, imported: { service, importer: src.importer, file: src.name, at: new Date().toISOString(), ...(partial ? { partial } : {}) } };
    delete known.from_phone;
  } else if (!known) {
    let theirs = null;
    if (!src.phone) try { theirs = JSON.parse((await (await src.read(`${chatPath}/progress.json`))?.text()) || 'null'); } catch { /* none */ }
    known = theirs && (theirs.history_complete ?? theirs.complete)
      ? { complete: !!theirs.complete, history_complete: true, ...(theirs.start ? { start: theirs.start } : {}), ...(theirs.newest_check ? { newest_check: theirs.newest_check } : {}), imported_from: src.name }
      : { complete: false, history_complete: false, imported_from: src.name };
  }
  const fromPhone = src.phone && !(known.history_complete ?? known.complete) && !known.from_phone;
  if (src.phone && !(known.history_complete ?? known.complete)) known = { ...known, from_phone: { file: src.name, at: src.manifest.updated_at || src.manifest.created_at || null } };
  if (row && libData && !fresh.length && !filled && contact === libData.contact && !fromPhone && !fromApp) return null;

  const merged = GMLib.mergeChrono(saved, fresh, incoming);
  const media = merged.flatMap((m) => m.media || []);
  const now = new Date().toISOString();
  const base = libData || data;
  const { range, ...rest } = base;
  const out = { ...rest, ...(service !== 'sms' ? { service } : {}), ...(account ? { account: account.id, account_label: account.label } : {}), conversation: base.conversation || title, conversation_id: base.conversation_id || data.conversation_id || null, exported_at: base.exported_at || now, updated_at: now,
    participants: [...new Set(merged.map((m) => m.sender))], message_count: merged.length, media_count: media.filter((x) => x.file).length, media_failed: media.filter((x) => !x.file).length, messages: merged, ...(contact ? { contact } : {}) };
  const dated = merged.filter((m) => m.timestamp);
  const prog = {
    ...known,
    message_count: merged.length, oldest: dated[0]?.timestamp || null, newest: dated[dated.length - 1]?.timestamp || null, updated_at: now,
  };
  prog.checks = GMLib.checkChat(merged, prog, contact);
  await io.write(`${folder}/messages.json`, JSON.stringify(out));
  await io.write(`${folder}/progress.json`, JSON.stringify(prog, null, 2));
  await io.write(`${folder}/chat.js`, GMLib.chatScript(folder, GMLib.compactMessages(folder, merged)));
  await io.write(`${folder}/messages.csv`, GMLib.chatCsv(out.conversation, folder, merged));
  const newRow = GMLib.summarize({ id: out.conversation_id, title: out.conversation, folder, data: out, progress: prog });
  if (row) rows[rows.indexOf(row)] = newRow; else { rows.push(newRow); report.newChats++; }
  report.chats.push(out.conversation);
  report.messages += fresh.length;
  log(`${row ? '+' : '★'} ${out.conversation}: ${fresh.length.toLocaleString()} messages${filled ? `, ${filled} missing photos` : ''} added${row ? '' : ' (new to the library)'}`);
  return newRow;
}

// After an import or clean-up: rewrites the library's index (data.js), the
// verification report, export-info.json with this run, the whole-library
// CSV, the run's log and SHA256SUMS.txt (dropping `removed` paths), and adds
// the run to Past runs.
async function finishLibraryRun(io, rows, exp, run, lines, summary, { ok = true, added = 0, target = '', removed = [], removedFolder = null } = {}) {
  const settings = await getSettings();
  const info = JSON.parse((await io.readText('export-info.json')) || '{}');
  const now = new Date();
  const version = chrome.runtime.getManifest().version;
  const pad = (x) => String(x).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  run.log_file = `logs/${stamp} - ${run.kind}.txt`;
  const newInfo = {
    tool: 'Message Archivist', version, created_at: info.created_at || now.toISOString(), updated_at: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, user_agent: navigator.userAgent, source: 'https://messages.google.com/web',
    case_note: settings.caseNote || info.case_note || '', hash_algorithm: 'SHA-256', verify_with: 'shasum -a 256 -c SHA256SUMS.txt', runs: [...(info.runs || []), run],
  };
  let state = null;
  try { state = JSON.parse((await io.readText('backup-state.json')) || 'null'); } catch { /* none */ }
  const ver = GMLib.verificationOf(rows, state, version);
  await io.write('data.js', GMLib.indexScript({ exported_at: newInfo.created_at, updated_at: newInfo.updated_at, info: { ...newInfo, runs: newInfo.runs.map(({ log_file, ...r }) => r) }, conversations: rows, skipped: exp?.skipped || [], verification: ver.summary }));
  await io.write('export-info.json', JSON.stringify(newInfo, null, 2));
  await io.write('verification.json', JSON.stringify(ver.full, null, 2));
  // Written once, or again if a file it runs on is missing (a viewer copied by
  // a run from before library.js or modules/): every file viewer.html loads.
  const fromExtension = async (f) => (await fetch(window.MA_APP?.archiveURL(f) || chrome.runtime.getURL(f))).text();
  const viewerHtml = await fromExtension('viewer.html');
  const viewerParts = GMLib.pageFiles(viewerHtml);
  if (!(await io.exists('index.html')) || (await Promise.all(viewerParts.map((f) => io.exists(f)))).includes(false)) {
    await io.write('index.html', viewerHtml);
    for (const f of viewerParts) await io.write(f, await fromExtension(f));
    await io.write('README.txt', GMLib.README);
  }
  const parts = [];
  for (const r of rows) { const t = await io.readText(`${r.folder}/messages.csv`); if (t) parts.push(t); }
  await io.write('messages.csv', GMLib.joinCsv(parts));
  if (settings.obsidian && io.dir) {
    try {
      const r = await updateObsidian(io.dir, rows);
      lines.push(`[${new Date().toISOString()}] Obsidian notes: ${r.written} written, ${r.same} unchanged${r.removed ? `, ${r.removed} removed` : ''}`);
    } catch (e) {
      lines.push(`[${new Date().toISOString()}] Obsidian notes not updated: ${e.message}`);
    }
  }
  await io.write(run.log_file, `Message Archivist ${version} — ${run.kind}\nStarted:   ${run.started_at}\nFinished:  ${now.toISOString()}\n${run.source ? `From:      ${run.source}\n` : ''}\n${lines.join('\n')}\n`);
  const sums = GMLib.parseSums(await io.readText('SHA256SUMS.txt'));
  for (const p of removed) sums.delete(p);
  if (removedFolder) for (const p of [...sums.keys()]) if (p.startsWith(`${removedFolder}/`)) sums.delete(p);
  for (const [p, h] of io.hashes) sums.set(p, h);
  await io.write('SHA256SUMS.txt', GMLib.formatSums(sums));
  const { runs = [] } = await chrome.storage.local.get('runs');
  runs.unshift({ at: now.toISOString(), kind: run.kind, target, ok, summary, added, log: lines });
  await chrome.storage.local.set({ runs: runs.slice(0, 30) });
}

// ---------- bring in conversations ----------
// One way in for everything: a phone backup from the Android app (.tar, and
// its updates file, and the other apps' exports shared to it on the phone),
// another app's export (its module in modules/, read by import.js), or an
// export made by an earlier version of this extension (zip or folder). Each
// picked file or folder is recognised by itself; all of them are merged in
// one run.

// What a picked file or folder is, as import sources (an earlier export can
// be several, and so can a folder of other apps' exports, and a phone backup
// with the exports shared to the Android app). Ones in it that looked like
// exports but couldn't be read go in `problems`.
async function sourcesFrom(picked, dir, ctx, note, problems = []) {
  const fromApps = async () => {
    const all = await GMImport.openAll(picked, ctx);
    problems.push(...all.skipped);
    return all.map((x) => x.source);
  };
  if (picked.kind === 'directory') {
    if (await picked.isSameEntry(dir)) throw new Error('That’s the backup folder itself. Pick an export, or the folder it’s in.');
    note(`Looking through ${picked.name}…`);
    const found = await findExports(picked, note);
    if (found.length) return found;
    return fromApps();
  }
  if (/\.tar$/i.test(picked.name)) {
    const phone = await phoneSource(picked);
    // Other apps' exports shared to the Android app, which keeps them in the
    // backup: each read by its app's module.
    const apps = await GMImport.packageExports(phone.pkg, picked.name, ctx);
    problems.push(...apps.skipped);
    return [phone, ...apps.map((x) => x.source)];
  }
  if (/\.zip$/i.test(picked.name)) {
    const found = zipExports(await GMZip.open(picked), picked.name);
    if (found.length) return found;
  }
  return fromApps();
}

// accounts.json: which ID is each app's main account, once an import has said.
async function readAccounts(io) {
  try { const a = JSON.parse((await io.readText('accounts.json')) || 'null'); if (a?.main) return a; } catch { /* none yet */ }
  return { version: 1, main: {} };
}

// Which account each source's chats go in (null: the app's main one, as
// every chat before accounts). A source that doesn't say whose it is goes in
// the main account. One that does: the main account if it's the main one's
// ID, or if the app has no main ID yet and none of its chats are here (it
// becomes the main); a separate account if it's another ID. If the app's
// chats are here but its main ID isn't known, `ask` says whether they're the
// same (in Settings, a question; without one, they're taken to be).
async function resolveAccounts(sources, rows, accounts, ask) {
  const decided = new Map();
  for (const src of sources) {
    if (src.accountChoice !== undefined) continue;
    const service = src.phone ? 'sms' : (src.chat?.(src.chats[0])?.data.service || src.service || 'sms');
    const o = src.owner;
    if (!o?.id) { src.accountChoice = null; continue; }
    const mine = { id: o.id, label: GMLib.accountLabel(o.id, o.label) };
    const key = `${service}|${GMLib.accountKey(o.id)}`;
    const main = accounts.main[service];
    if (decided.has(key)) src.accountChoice = decided.get(key);
    else if (main) src.accountChoice = GMLib.sameAccount(main.id, o.id) ? null : mine;
    else if (!rows.some((r) => GMLib.serviceOf(r) === service && !r.account) || !ask || await ask(service, mine, src)) {
      accounts.main[service] = mine;
      accounts.changed = true;
      src.accountChoice = null;
    } else src.accountChoice = mine;
    decided.set(key, src.accountChoice);
  }
}

// The question, when an app's chats are already here and nothing says from which account.
function askSameAccount(service, mine) {
  const app = GMLib.serviceLabel(service);
  return new Promise((resolve) => {
    $('whoTitle').textContent = service === 'sms' ? `Texts from ${mine.label}` : `${app}: ${mine.label}`;
    $('whoText').textContent = service === 'sms'
      ? `This phone backup is from ${mine.label}. Your archive already has Google Messages texts. Are they from this same number? If not, these are kept apart as another number’s texts.`
      : `This export is from ${mine.label}. Your archive already has ${app} chats. Are they from this same account? If not, these are kept apart as another account’s.`;
    $('whoList').innerHTML = `<button class="filled" data-same="1" style="text-align:left">Yes, the same ${service === 'sms' ? 'number' : 'account'}</button><button class="outlined" data-same="0" style="text-align:left">No, keep them separate</button>`;
    $('whoList').onclick = (e) => { const b = e.target.closest('[data-same]'); if (b) { $('whoDlg').close(); resolve(b.dataset.same === '1'); } };
    $('whoSkip').textContent = 'Not sure: the same';
    $('whoSkip').onclick = () => { $('whoDlg').close(); resolve(true); };
    $('whoDlg').showModal();
  });
}

// One line per source for the confirm.
function describeSource(src, rows) {
  const apart = src.accountChoice ? ` Kept apart as ${GMLib.serviceLabel(src.phone ? 'sms' : src.service)} · ${src.accountChoice.label}.` : '';
  if (src.phone) {
    const c = src.manifest.counts || {};
    const matched = src.chats.filter((k) => GMLib.phoneRowFor(rows, src.thread(k))).length;
    return `• “${src.name}”${src.manifest.updates_since ? ` (the updates file${src.manifest.updates_for ? ` for “${src.manifest.updates_for}”` : ''})` : ''}, a phone backup: ${(c.messages || 0).toLocaleString()} messages in ${src.chats.length.toLocaleString()} chats${c.media ? `, ${c.media.toLocaleString()} photos and videos` : ''}; ${matched.toLocaleString()} match chats already here by phone number.${apart}`;
  }
  if (src.importer) {
    const svc = src.chat(src.chats[0])?.data.service || src.service;
    return `• “${src.name}”, from ${GMLib.serviceLabel(svc)}: ${src.chats.length.toLocaleString()} chat${src.chats.length === 1 ? '' : 's'}, ${src.chats.reduce((n, k) => n + src.chat(k).data.messages.length, 0).toLocaleString()} messages.${apart}`;
  }
  return `• “${src.name}”, an earlier export: ${src.chats.length.toLocaleString()} chat${src.chats.length === 1 ? '' : 's'}.`;
}

// Where a bring-in says how it's going: under the button it was started from
// (Tools, or the Apps tab).
const importMsg = () => $(tab === 'apps' ? 'appsMsg' : 'importMsg');
async function importAnything(pickFolder, given = null) {
  const note = (t) => { importMsg().textContent = t; };
  const lines = [];
  try {
    const dir = await folderForReading();
    const picked = given ? await Promise.all(given.map((h) => (h.getFile ? h.getFile() : h)))
      : pickFolder ? [await window.showDirectoryPicker({ id: 'gm-import', mode: 'read' })]
      : await Promise.all((await window.showOpenFilePicker({ id: 'gm-import', multiple: true })).map((h) => h.getFile()));
    const ctx = { whoAmI, locale: navigator.language };
    const sources = [];
    const problems = [];
    for (const p of picked) {
      note(`Reading ${p.name}…`);
      try { sources.push(...(await sourcesFrom(p, dir, ctx, note, problems))); } catch (e) { problems.push(`“${p.name}”: ${e.message}`); }
    }
    for (const x of problems) lines.push(`[${new Date().toISOString()}] ! ${x}`);
    if (!sources.some((x) => x.chats.length)) { note(problems.join(' ') || 'There’s nothing to bring in there: no chats.'); return; }
    // A phone backup's big file before its updates file, so nothing is missed.
    const rank = (x) => (x.phone ? (x.manifest.updates_since ? 2 : 1) : 0);
    sources.sort((a, b) => rank(a) - rank(b) || (a.phone && b.phone ? String(a.manifest.updates_since || a.manifest.created_at || '').localeCompare(String(b.manifest.updates_since || b.manifest.created_at || '')) : 0));
    const rows = (await getLib(true)).rows || [];
    const accounts = await readAccounts(libraryIO(dir));
    await resolveAccounts(sources, rows, accounts, askSameAccount);
    const partial = sources.find((x) => x.partial);
    const updatesAlone = sources.some((x) => x.phone && x.manifest.updates_since) && !sources.some((x) => x.phone && !x.manifest.updates_since);
    if (!confirm(`Bring ${sources.length === 1 ? 'this' : 'these'} into “${dir.name}”?\n\n${sources.map((x) => describeSource(x, rows)).join('\n')}${problems.length ? `\n\nLeft out:\n${problems.join('\n')}` : ''}${partial ? `\n\n${partial.partial}` : ''}${updatesAlone ? '\n\nThat’s an updates file: it has only the newest messages. Bring in its big backup too (now or before) for the rest.' : ''}\n\nOnly messages and photos that aren’t here yet are added. The files you picked aren’t changed.`)) { note(''); return; }
    await mergeExports(dir, sources, note, lines, accounts);
    await getLib(true);
    if (tab === 'apps') renderApps();
  } catch (e) {
    if (e.name !== 'AbortError') note(e.message);
  }
}

// The address book in the library (contacts.json, and contacts.js for the
// folder's index.html), replaced by a phone backup's when that's newer. A
// phone that stopped saving every contact brings an empty one, which takes
// them out. Returns the book written, or null.
async function newestBook(io, sources, log) {
  let have = null;
  try { have = JSON.parse((await io.readText('contacts.json')) || 'null'); } catch { /* none yet */ }
  let best = null;
  for (const src of sources) {
    const b = src.book ? await src.book() : null;
    if (b && (!best || b.captured_at > best.captured_at)) best = b;
  }
  if (!best || (have?.captured_at && have.captured_at >= best.captured_at)) return null;
  const book = { format: 'gm-address-book', version: 1, captured_at: best.captured_at, contacts: best.contacts };
  await io.write('contacts.json', JSON.stringify(book, null, 2));
  await io.write('contacts.js', `window.GM_CONTACTS = ${JSON.stringify(book)};\n`);
  log(book.contacts.length ? `Address book: ${book.contacts.length} contacts from the phone` : 'Address book: emptied (the phone no longer saves every contact)');
  return book;
}

// Merges the chats of `sources` into the library in `dir`, then rewrites the
// library's index, verification report, whole-library CSV, log and checksums.
async function mergeExports(dir, sources, note, lines = [], accounts = null) {
  const log = (t) => lines.push(`[${new Date().toISOString()}] ${t}`);
  const chats = sources.reduce((n, x) => n + x.chats.length, 0);
  const started = new Date();
  const io = libraryIO(dir);
  const lib = await GMLib.readLibrary(io, log);
  const rows = lib?.rows || [];
  accounts = accounts || await readAccounts(io);
  await resolveAccounts(sources, rows, accounts, null);
  const report = { chats: [], newChats: 0, messages: 0, media: 0, skipped: 0, missing: 0, mismatch: 0, errors: 0, left: {} };
  // Codes, promotions or automated texts Settings leaves out (importChat).
  report.skip = GMLib.skipKinds(await getSettings());
  if (report.skip.size) { try { report.labels = JSON.parse((await io.readText('labels.json')) || 'null'); } catch { /* none */ } }
  log(`Importing ${chats} chats from: ${sources.map((x) => x.name).join(', ')}`);
  let n = 0;
  for (const src of sources) {
    for (const chatPath of src.chats) {
      note(`Importing ${++n} of ${chats}: ${src.name} › ${chatPath.split('/').pop()}`);
      try {
        const data = JSON.parse(await (await src.read(`${chatPath}/messages.json`)).text());
        await importChat(io, rows, src, chatPath, data, report, log);
      } catch (e) {
        report.errors++;
        log(`✗ ${src.name} › ${chatPath}: ${e.message}`);
      }
    }
  }

  if (accounts.changed) { delete accounts.changed; await io.write('accounts.json', JSON.stringify(accounts, null, 2)); }
  // The phone's address book: the newest a phone backup brought, which
  // People, the viewer and the Obsidian notes tie chats to.
  const book = await newestBook(io, sources, log);
  if (book) report.book = book.contacts.length;
  note('Updating the library’s index and checksums…');
  const leftOut = Object.entries(report.left);
  const summary = `Imported ${report.chats.length} chat${report.chats.length === 1 ? '' : 's'} (${report.newChats} new to the library): ${report.messages.toLocaleString()} messages and ${report.media.toLocaleString()} media files added; ${report.skipped.toLocaleString()} messages were already there.` +
    `${leftOut.length ? ` Left out ${leftOut.map(([k, n]) => `${n.toLocaleString()} chat${n === 1 ? '' : 's'} of ${GMLib.CHAT_KINDS[k].toLowerCase()}`).join(', ')} (Settings → Leave out of your archive).` : ''}` +
    `${report.book ? ` The phone’s address book (${report.book.toLocaleString()} contacts) ties chats from every app to their people.` : report.book === 0 ? ' The phone no longer saves every contact, so the address book was emptied.' : ''}${report.missing ? ` ${report.missing} media files were missing from the exports.` : ''}${report.mismatch ? ` ${report.mismatch} didn’t match their recorded checksums (see the log).` : ''}${report.errors ? ` ${report.errors} chats couldn’t be read (see the log).` : ''}`;
  log(summary);
  await finishLibraryRun(io, rows, lib?.exp, { kind: 'import', started_at: started.toISOString(), source: sources.map((x) => x.name).join(', '), chats: report.chats, added_messages: report.messages, added_media: report.media },
    lines, summary, { ok: !report.errors, added: report.messages, target: sources.map((x) => x.name).join(', ') });
  const fresh = rows.filter((r) => r.id && r.status === 'incomplete' && report.chats.includes(r.title));
  importMsg().innerHTML = `${esc(summary)}${fresh.length ? ` Chats new to the library show as “Unfinished” until a backup reads them in full from Messages. <button id="importToList" class="tonal small">Add them to my backup list</button>` : ''}`;
  importedRows = fresh;
  return report;
}
let importedRows = [];
$('importAny').onclick = () => importAnything(false);
$('importAnyFolder').onclick = () => importAnything(true);
// A phone backup opened with the app (File Handling: "Open with", or a double
// click once the app is the default for .tar files).
window.MA_APP?.onFiles((handles) => { showTab('tools'); importAnything(false, handles); });

// ---------- bring in conversations from other apps ----------
// Each app's own export (modules/), read into library chats and merged like
// any other export: matched to chats of the same app, only new messages added.

// "Which one is you?": asked when an export doesn't say whose it is, and
// remembered per app (Settings keeps the names in chrome.storage, `myNames`).
async function whoAmI(service, names, hint = {}) {
  const store = (await chrome.storage.local.get('myNames')).myNames || {};
  const known = (store[service] || []).find((n) => names.includes(n));
  if (known) return known;
  if (!names.length) return null;
  const pick = await new Promise((resolve) => {
    $('whoTitle').textContent = 'Which one is you?';
    $('whoSkip').textContent = 'None of these';
    $('whoText').textContent = `In ${GMLib.serviceLabel(service)}${hint.chat ? ` (“${hint.chat}”)` : ''}, which name is yours? Your messages are shown on your side, and the name is remembered for next time.`;
    $('whoList').innerHTML = names.slice(0, 40).map((n, i) => `<button class="outlined" data-who="${i}" style="text-align:left">${esc(n)}</button>`).join('');
    $('whoList').onclick = (e) => { const b = e.target.closest('[data-who]'); if (b) { $('whoDlg').close(); resolve(names[+b.dataset.who]); } };
    $('whoSkip').onclick = () => { $('whoDlg').close(); resolve(null); };
    $('whoDlg').showModal();
  });
  if (pick) await chrome.storage.local.set({ myNames: { ...store, [service]: [...new Set([...(store[service] || []), pick])] } });
  return pick;
}

$('importHow').innerHTML = [
  ['Message Archivist (Android)', 'In the app: Back up this phone, then copy the .tar it saved to this computer (from Google Drive, wait until the download has finished; Drive asks “Download anyway?” for big files). If you use an updates file, pick it too. Chats you shared to the app from WhatsApp, and downloads you added there, come in with it.'],
  ...GMLib.modules().filter((m) => m.reader).map((m) => [m.label, m.steps.join(' ')]),
  ['Earlier versions of this extension', 'The zips or folders they made (a folder that holds several is fine too).'],
].map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`).join('');

// ---------- apps ----------
// One card per app module (modules/, GMLib.modules()): Google Messages, the
// core, first, then each other app with what the archive has from it, when
// its chats last came in, and how to get its export; then the apps that
// can't come in yet, and why.
const PHONE = {
  share: 'On Android you can share the export to the Message Archivist app instead: it goes into your phone backup, and comes in here with it.',
  download: 'On Android you can download it on the phone and share it to the Message Archivist app (or add it there): it goes into your phone backup, and comes in here with it.',
};
async function renderApps() {
  const lib = await getLib();
  const have = new Map();
  for (const r of lib.rows || []) {
    const s = GMLib.serviceOf(r);
    const a = have.get(s) || { chats: 0, messages: 0, at: null };
    a.chats++;
    a.messages += r.count || 0;
    if (r.imported_at && (!a.at || r.imported_at > a.at)) a.at = r.imported_at;
    have.set(s, a);
  }
  const day = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const status = (m) => {
    const a = have.get(m.id);
    if (!a) return lib.rows ? 'Nothing in your archive from it yet.' : '';
    return `${a.chats.toLocaleString()} chat${a.chats === 1 ? '' : 's'}, ${a.messages.toLocaleString()} message${a.messages === 1 ? '' : 's'} in your archive${a.at ? `; last brought in ${day(a.at)}` : ''}.`;
  };
  const all = GMLib.modules();
  // An app's web page reader (the extension only: the app can't register one):
  // whether it's on, and what it has kept for the archive.
  const web = new Map();
  if (chrome.scripting?.getRegisteredContentScripts) {
    const regs = await chrome.scripting.getRegisteredContentScripts().catch(() => []);
    const kept = await chrome.storage.local.get(null);
    for (const m of all.filter((x) => x.web)) {
      const keys = Object.keys(kept).filter((k) => k.startsWith(`webcap:${m.id}:`));
      web.set(m.id, {
        on: regs.some((r) => r.id === `web-${m.id}`) && await chrome.permissions.contains({ origins: m.web.origins }),
        chats: keys.length, messages: keys.reduce((n, k) => n + Object.keys(kept[k]?.items || {}).length, 0),
      });
    }
  }
  const webBlock = (m) => {
    const w = web.get(m.id);
    if (!w) return '';
    return `<div class="web-read">
      <label class="check"><input type="checkbox" data-web="${esc(m.id)}"${w.on ? ' checked' : ''}> Keep the chats I open on ${esc(m.web.label)}</label>
      <p class="secondary">Its download has only saved messages, so this keeps the others as you read them there. It only reads the page: no clicks, no Snaps opened, nothing saved in ${esc(m.label)}, no screenshots. Reload ${esc(m.web.label)} after turning it on.${w.messages ? ` <b>${w.messages.toLocaleString()} message${w.messages === 1 ? '' : 's'} from ${w.chats.toLocaleString()} chat${w.chats === 1 ? '' : 's'} waiting.</b>` : ''}</p>
      ${w.messages ? `<button class="filled small" data-webin="${esc(m.id)}">Put them in my archive</button>` : ''}
    </div>`;
  };
  const card = (m, actions) => `<section class="card app-card" style="--app:${esc(m.color)}">
    <h2><span class="app-dot"></span>${esc(m.label)}</h2>
    <span class="secondary">${esc(status(m))}${m.partial ? ` ${esc(m.partial)}` : ''}</span>
    ${m.steps?.length ? `<ol class="app-steps secondary">${m.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${PHONE[m.phone] ? `<p class="secondary">${esc(PHONE[m.phone])}</p>` : ''}
    ${m.web ? webBlock(m) : ''}
    <div class="row">${actions}</div></section>`;
  const later = all.filter((m) => m.later);
  $('appCards').innerHTML = [
    ...all.filter((m) => m.core).map((m) => card(m, '<button class="tonal small" data-go="backups">Backups</button><button class="outlined small" data-go="restore">Phone restore</button>')),
    ...all.filter((m) => !m.core && m.reader).map((m) => card(m, `<button class="tonal small" data-bring="files">Bring in ${esc(m.label)} files…</button><button class="outlined small" data-bring="folder">A folder…</button>`)),
    later.length ? `<section class="card"><h2>Not yet</h2>${later.map((m) => `<p class="secondary"><b>${esc(m.label)}:</b> ${esc(m.later)}</p>`).join('')}</section>` : '',
  ].join('');
}
$('appCards').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-go], button[data-bring], button[data-webin]');
  if (!b) return;
  if (b.dataset.go) showTab(b.dataset.go);
  else if (b.dataset.webin) bringInWeb(b.dataset.webin);
  else importAnything(b.dataset.bring === 'folder');
});
$('appCards').addEventListener('change', async (e) => {
  const box = e.target.closest('input[data-web]');
  const m = box && GMLib.module(box.dataset.web);
  if (!m?.web) return;
  box.checked = await setWebReader(m, box.checked).catch((err) => { importMsg().textContent = err.message; return false; });
  renderApps();
});

// Turns an app's web page reader on or off: Chrome is asked to let the
// extension read that site (an optional permission, asked only here, on the
// click), and the reader is registered for its pages; off, it's unregistered
// and the permission given back.
async function setWebReader(m, on) {
  const id = `web-${m.id}`;
  if (on && !(await chrome.permissions.request({ origins: m.web.origins }))) return false;
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  if (!on) { await chrome.permissions.remove({ origins: m.web.origins }).catch(() => {}); return false; }
  await chrome.scripting.registerContentScripts([{ id, matches: m.web.matches, js: [m.web.script], runAt: 'document_idle', persistAcrossSessions: true }]);
  return true;
}

// Puts what an app's web page reader kept (webcap:<service>:*, background.js)
// into the archive, as an import of its own ("<App> for Web"), then takes it
// out of the queue. The keys it put in are kept (webdone:…), so reading those
// chats again doesn't queue them again; what the page read meanwhile stays.
async function bringInWeb(service) {
  const note = (t) => { importMsg().textContent = t; };
  try {
    const dir = await folderForReading();
    const kept = await chrome.storage.local.get(null);
    const keys = Object.keys(kept).filter((k) => k.startsWith(`webcap:${service}:`));
    if (!keys.length) { note('Nothing is waiting.'); return; }
    const src = GMImport.webSource(service, keys.map((k) => kept[k]));
    const rows = (await getLib(true)).rows || [];
    const accounts = await readAccounts(libraryIO(dir));
    await resolveAccounts([src], rows, accounts, askSameAccount);
    await mergeExports(dir, [src], note, [], accounts);
    const now = await chrome.storage.local.get(keys.flatMap((k) => [k, k.replace(/^webcap:/, 'webdone:')]));
    for (const k of keys) {
      const doneKey = k.replace(/^webcap:/, 'webdone:');
      const put = Object.keys(kept[k]?.items || {});
      const left = { ...(now[k]?.items || {}) };
      for (const key of put) delete left[key];
      await chrome.storage.local.set({ [doneKey]: [...new Set([...(now[doneKey] || []), ...put])] });
      if (Object.keys(left).length) await chrome.storage.local.set({ [k]: { ...now[k], items: left } });
      else await chrome.storage.local.remove(k);
    }
    await getLib(true);
    renderApps();
  } catch (e) {
    if (e.name !== 'AbortError') note(e.message);
  }
}
$('appsImport').onclick = () => importAnything(false);
$('appsImportFolder').onclick = () => importAnything(true);


document.addEventListener('click', async (e) => {
  if (e.target.id !== 'importToList') return;
  const s = await getSettings();
  const have = new Set(s.schedules.map((j) => j.id));
  const add = importedRows.filter((r) => !have.has(r.id)).map((r) => ({ id: r.id, title: r.title, everyHours: 0, enabled: true, addedAt: Date.now() }));
  await saveSettings({ schedules: [...s.schedules, ...add] });
  toast(`Added ${add.length} chat${add.length === 1 ? '' : 's'} to your backup list. “Back up all now” reads them in full.`);
  e.target.remove();
});

// ---------- add chats from Messages ----------

let chatList = [];
const chatName = (c) => c.name || c.title || 'Unnamed chat';
function renderPick() {
  const q = $('chatFilter').value.trim().toLowerCase();
  getSettings().then((s) => {
    const have = new Set(s.schedules.map((j) => j.id));
    // Pinned chats first, then names A–Z, then numbers, as in every list.
    const order = GMLib.chatOrder((c) => !!c.pinned);
    const list = chatList.filter((c) => !q || chatName(c).toLowerCase().includes(q))
      .sort((a, b) => order({ title: chatName(a), pinned: a.pinned }, { title: chatName(b), pinned: b.pinned }));
    const free = list.filter((c) => !have.has(c.id)).length;
    // "Select all" is its own control above the list, not a row in it.
    $('pickAll').hidden = !free;
    $('pickAllLabel').textContent = q ? `Select all ${free} matching chats` : `Select all ${free} chats not on your list`;
    $('chatPick').innerHTML = list.map((c) => `<label><input type="checkbox" value="${esc(c.id)}"${have.has(c.id) ? ' checked disabled' : ''}><span>${c.pinned ? '📌 ' : ''}${c.name ? esc(GMLib.formatNumber(c.name)) : '<i class="gray">Unnamed chat</i>'}${c.group ? ' <span class="secondary">group</span>' : ''}${have.has(c.id) ? ' <span class="secondary">already on your list</span>' : ''}</span><span class="when">${esc(c.when)}</span></label>`).join('') || '<div class="empty" style="padding:12px">No chats match.</div>';
    syncAdd();
  });
}
function syncAdd() {
  const boxes = [...$('chatPick').querySelectorAll('input:not(:disabled)')];
  const n = boxes.filter((b) => b.checked).length;
  $('pickAllBox').checked = !!boxes.length && n === boxes.length;
  $('pickAllBox').indeterminate = n > 0 && n < boxes.length;
  $('addSelected').disabled = !n;
  $('addSelected').textContent = n ? `Add ${n} chat${n === 1 ? '' : 's'}` : 'Add selected';
}
$('pickAllBox').addEventListener('change', () => {
  for (const b of $('chatPick').querySelectorAll('input:not(:disabled)')) b.checked = $('pickAllBox').checked;
  syncAdd();
});
$('addChats').onclick = async () => {
  $('addPanel').hidden = false;
  $('addMsg').textContent = 'Reading your conversation list from the Messages tab…';
  $('chatPick').innerHTML = '';
  const res = await chrome.runtime.sendMessage({ type: 'gm-to-tab', focus: false, message: { type: 'gm-list-chats', limit: 500 } });
  if (!res?.ok) { $('addMsg').textContent = res?.error || 'Open Google Messages in a Chrome tab first, then try again.'; return; }
  chatList = res.chats;
  // Chats on your list saved without a name get their name back.
  const s0 = await getSettings();
  const names = new Map(chatList.filter((c) => c.name).map((c) => [c.id, c.name]));
  if (s0.schedules.some((j) => !j.title && names.has(j.id))) {
    await saveSettings({ schedules: s0.schedules.map((j) => (!j.title && names.has(j.id) ? { ...j, title: names.get(j.id) } : j)) });
  }
  $('addMsg').textContent = `${chatList.length} conversations found. Tick the ones to keep backed up. (If some are missing, click on the Google Messages tab once and try again: Chrome loads the list more slowly while that tab isn't showing.)`;
  renderPick();
};
$('chatFilter').addEventListener('input', renderPick);
$('chatPick').addEventListener('change', syncAdd);
$('addCancel').onclick = () => { $('addPanel').hidden = true; };
$('addSelected').onclick = async () => {
  const ids = [...$('chatPick').querySelectorAll('input:checked:not(:disabled)')].map((i) => i.value);
  const s = await getSettings();
  const every = +$('addEvery').value;
  const add = ids.map((id) => chatList.find((c) => c.id === id)).filter(Boolean)
    .map((c) => ({ id: c.id, title: chatName(c), everyHours: every, enabled: true, addedAt: Date.now() }));
  await saveSettings({ schedules: [...s.schedules.filter((j) => !ids.includes(j.id)), ...add] });
  toast(`Added ${add.length} chat${add.length === 1 ? '' : 's'} to your backup list.`);
  $('addPanel').hidden = true;
};

// ---------- start ----------
renderForm();
renderFolder();
renderTotal();
if (!routed) {
  const h = location.hash.slice(1);
  if (h === 'folder') {
    showTab('settings');
    settingsMode(false);
    $('chooseFolder').scrollIntoView({ block: 'center' });
  } else if (h.startsWith('archive/')) openArchive(h.slice(8));
  else if (TABS.includes(h) || h === 'welcome') showTab(TABS.includes(h) ? h : 'home', { push: h !== 'welcome' });
  // Nothing asked for: the archive once there's a folder, else Home and its setup steps.
  else getDir().then((dir) => showTab(dir ? 'archive' : 'home'));
}
addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (h.startsWith('archive/')) { openArchive(h.slice(8)); return; }
  // The app's viewer opens these in the Settings window it already has.
  if (h.startsWith('delete:')) { showTab('backups'); askDelete(decodeURIComponent(h.slice(7)), false); return; }
  if (h === 'folder') { showTab('settings'); settingsMode(false); $('chooseFolder').scrollIntoView({ block: 'center' }); return; }
  if (TABS.includes(h) && h !== tab) showTab(h, { push: false });
});
