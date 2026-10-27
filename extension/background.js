// Background service worker:
//  - fetches media the page can't read because of CORS
//  - puts date-range zips into the chosen subfolder of Downloads
//  - runs scheduled exports/updates in the open Messages tab
//  - relays actions from the settings page to that tab

importScripts('library.js'); // GMLib: shared settings defaults

const MESSAGES_URL = 'https://messages.google.com/web/*';

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return GMLib.normalizeSettings(settings);
}
async function saveSettings(patch) {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
}

// ---------- downloads into a subfolder ----------
// The page names the zip; this adds the folder in front of it.

const expected = new Map(); // file name -> subfolder

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const base = item.filename.split(/[\\/]/).pop();
  const sub = expected.get(base);
  if (sub == null || !item.url.startsWith('blob:https://messages.google.com')) return;
  expected.delete(base);
  const clean = sub.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^[\\/]+|[\\/]+$/g, '');
  suggest({ filename: clean ? `${clean}/${base}` : base, conflictAction: 'uniquify' });
});

// ---------- schedules ----------

const HOUR = 3600000;

function ensureAlarm() {
  chrome.alarms.get('gm-schedule', (a) => { if (!a) chrome.alarms.create('gm-schedule', { periodInMinutes: 15, delayInMinutes: 1 }); });
}
// Saves settings from older versions in the current form (see
// GMLib.normalizeSettings), so every part reads the same thing.
async function migrateSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  if (settings && settings.settingsVersion === GMLib.SETTINGS_VERSION) return;
  await chrome.storage.local.set({ settings: GMLib.normalizeSettings(settings) });
}
chrome.runtime.onInstalled.addListener((details) => {
  ensureAlarm();
  migrateSettings();
  // First install: walk through choosing the backup folder.
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
});
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); migrateSettings(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'gm-schedule') runDue(); });

async function messagesTab() {
  const tabs = await chrome.tabs.query({ url: MESSAGES_URL });
  return tabs.find((t) => t.active) || tabs[0] || null;
}

// ---------- keeping Google Messages working on its own ----------
// Messages only loads older history while its page is showing. So a backup
// moves its tab into a window of its own (where it stays showing while you
// use other windows), un-minimises that window if needed, and a scheduled
// backup with no Messages tab open opens one itself and closes it after.

const BACKUP_WINDOW = { type: 'normal', width: 560, height: 900 };
// "Keep that window small, in a corner": the same width (Messages' layout is
// known to work at it), less height. It has to stay on screen: Chrome stops
// drawing a window that's minimised or completely covered.
const COMPACT = { width: 560, height: 600, margin: 8 };

// Where the compact window goes, on the screen the Messages tab is on (the
// page reports it; a service worker has no screen of its own).
async function compactBounds(tab, corner) {
  const s = (await sendToTab(tab, { type: 'gm-ping' }).catch(() => null))?.screen;
  if (!s?.width || !s?.height) return null;
  const width = Math.min(COMPACT.width, s.width);
  const height = Math.min(COMPACT.height, s.height);
  const right = !corner.endsWith('left');
  const bottom = !corner.startsWith('top');
  return {
    left: Math.round(right ? s.left + s.width - width - COMPACT.margin : s.left + COMPACT.margin),
    top: Math.round(bottom ? s.top + s.height - height - COMPACT.margin : s.top + COMPACT.margin),
    width, height,
  };
}

// Shrinks the backup's window into a corner, if Settings says so. A window
// that was already there (not one made for the backup) gets its size back
// when the backup ends; that's kept in session storage, which outlives this
// worker being stopped.
async function compactWindow(tab, windowId, { remember = false } = {}) {
  const s = await getSettings();
  if (s.backupWindow !== 'corner') return false;
  const bounds = await compactBounds(tab, s.compactCorner || 'bottom-right');
  if (!bounds) return false;
  const w = await chrome.windows.get(windowId);
  if (remember) {
    const { restore = {} } = await chrome.storage.session.get('restore');
    restore[tab.id] = { windowId, state: w.state, left: w.left, top: w.top, width: w.width, height: w.height };
    await chrome.storage.session.set({ restore });
  }
  // A maximised or full-screen window can't be resized.
  if (w.state !== 'normal') await chrome.windows.update(windowId, { state: 'normal' });
  await chrome.windows.update(windowId, bounds);
  return true;
}

async function restoreWindow(tab) {
  const { restore = {} } = await chrome.storage.session.get('restore');
  const r = restore[tab.id];
  if (!r) return false;
  delete restore[tab.id];
  await chrome.storage.session.set({ restore });
  if (r.windowId !== tab.windowId) return false; // the tab has moved since
  await chrome.windows.update(r.windowId, r.state === 'normal' ? { left: r.left, top: r.top, width: r.width, height: r.height } : { state: r.state });
  return true;
}

async function ownWindow(tab, focused = true) {
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  const others = await chrome.tabs.query({ windowId: tab.windowId });
  if (others.length > 1) {
    const w = await chrome.windows.create({ ...BACKUP_WINDOW, tabId: tab.id, focused });
    return { moved: true, windowId: w.id, compact: await compactWindow(tab, w.id).catch(() => false) };
  }
  const w = await chrome.windows.get(tab.windowId);
  if (w.state === 'minimized') await chrome.windows.update(w.id, { state: 'normal', focused });
  return { moved: false, windowId: w.id, compact: await compactWindow(tab, w.id, { remember: true }).catch(() => false) };
}

async function keepVisible(tab) {
  let changed = false;
  const w = await chrome.windows.get(tab.windowId);
  if (w.state === 'minimized') { await chrome.windows.update(w.id, { state: 'normal', focused: false }); changed = true; }
  if (!tab.active) { await chrome.tabs.update(tab.id, { active: true }); changed = true; }
  return { changed };
}

// Opens Google Messages in a window of its own and waits until it's ready
// (the page answers, and its conversation list shows the phone is paired).
async function openMessagesWindow() {
  const w = await chrome.windows.create({ ...BACKUP_WINDOW, url: 'https://messages.google.com/web/conversations', focused: false });
  const tab = w.tabs[0];
  chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const ping = await sendToTab(tab, { type: 'gm-ping' });
      if (ping?.paired) {
        await compactWindow(tab, w.id).catch(() => {});
        return { tab, windowId: w.id };
      }
    } catch { /* still loading */ }
  }
  return { tab, windowId: w.id, notPaired: true };
}

async function sendToTab(tab, msg) {
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['zip.js', 'library.js', 'content.js'] });
    return chrome.tabs.sendMessage(tab.id, msg);
  }
}

function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message: message.slice(0, 300) });
}

// Runs schedules that are due, or the given ones for "Run now" / "Back up all
// now" (interactive: the Messages tab is brought forward and may ask for
// folder access). Chats set to "manual" (everyHours 0) only run on request.
async function runDue(onlyIds = null, interactive = false, retryFailed = false) {
  const settings = await getSettings();
  const now = Date.now();
  const jobs = settings.schedules.filter((s) => onlyIds ? onlyIds.includes(s.id)
    : s.enabled !== false && s.everyHours > 0 && (!s.lastRun || now - s.lastRun >= s.everyHours * HOUR - 5 * 60000));
  if (!jobs.length) return { ok: true, ran: 0 };

  let tab = await messagesTab();
  const mark = async (patchFor) => {
    const cur = await getSettings();
    await saveSettings({ schedules: cur.schedules.map((s) => jobs.some((j) => j.id === s.id) ? { ...s, ...patchFor(s) } : s) });
  };
  // No Google Messages tab: open one in its own window, and close it after.
  let opened = null;
  if (!tab) {
    opened = await openMessagesWindow();
    tab = opened.tab;
    if (opened.notPaired) {
      chrome.windows.remove(opened.windowId).catch(() => {});
      await mark(() => ({ lastTried: now, lastResult: 'Skipped: Google Messages needs your phone connected again. Open it and pair your phone.', lastOk: false }));
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#dd4b39' });
      return { ok: false, error: 'Google Messages isn’t connected to your phone. Open it, connect your phone, then try again.' };
    }
  }
  let res;
  try {
    if (interactive) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else if (!opened && settings.backupWindow !== 'tab') {
      // An automatic backup needs the page showing: if it's a background tab,
      // give it a window of its own (without taking the focus).
      const w = await chrome.windows.get(tab.windowId);
      if (!tab.active || w.state === 'minimized') await ownWindow(tab, false);
    }
    res = await sendToTab(tab, { type: 'gm-scheduled', interactive, retryFailed, jobs: jobs.map(({ id, title }) => ({ id, title })) });
  } catch (e) {
    res = { ok: false, error: e.message };
  }
  if (opened) chrome.windows.remove(opened.windowId).catch(() => {});
  if (!res?.ok) {
    await mark(() => ({ lastTried: now, lastResult: `Skipped: ${res?.error || 'the Messages tab did not respond'}`, lastOk: false }));
    return res;
  }
  const byId = new Map(res.results.map((r) => [r.id, r]));
  await mark((s) => {
    const r = byId.get(s.id) || { ok: false, summary: 'No result' };
    return {
      lastRun: r.ok ? now : s.lastRun, lastTried: now, lastResult: r.summary.split('\n')[0], lastOk: r.ok, lastAdded: r.added || 0,
      ...(r.count != null ? { complete: !!r.complete, count: r.count, oldest: r.oldest, status: r.status || null } : {}),
    };
  });
  const added = res.results.reduce((n, r) => n + (r.added || 0), 0);
  const failed = res.results.filter((r) => !r.ok);
  chrome.action.setBadgeText({ text: failed.length ? '!' : added ? String(Math.min(added, 999)) : '' });
  chrome.action.setBadgeBackgroundColor({ color: failed.length ? '#dd4b39' : '#3d9400' });
  if (settings.notify !== false) {
    notify(failed.length ? 'Scheduled export needs attention' : 'Scheduled export finished',
      res.results.map((r) => `${jobs.find((j) => j.id === r.id)?.title}: ${r.summary.split('\n')[0]}`).join('\n'));
  }
  return { ok: true, ran: jobs.length };
}

// ---------- messages ----------

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  switch (msg?.type) {
    case 'gm-fetch':
      // Media the page itself can't read because of CORS (e.g. googleusercontent.com).
      // Other websites (link-preview pictures) only if Settings allowed them.
      chrome.permissions.contains({ origins: [`${new URL(msg.url).origin}/*`] })
        .then((allowed) => {
          if (!allowed) { reply({ ok: false, blocked: true, error: 'not allowed to read this website' }); return null; }
          return fetch(msg.url, { credentials: 'include' });
        })
        .then(async (res) => {
          if (!res) return;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = new Uint8Array(await res.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          reply({ ok: true, type: res.headers.get('content-type') || '', b64: btoa(bin) });
        })
        .catch((err) => reply({ ok: false, error: String(err) }));
      return true;
    case 'gm-expect-download':
      expected.set(msg.name, msg.subfolder || '');
      setTimeout(() => expected.delete(msg.name), 10 * 60000);
      reply({ ok: true });
      return false;
    case 'gm-run-now':
      runDue(msg.ids, true, !!msg.retryFailed).then(reply);
      return true;
    case 'gm-to-tab':
      // From the settings page: bring the Messages tab forward and pass the message on.
      messagesTab().then(async (tab) => {
        if (!tab) return reply({ ok: false, error: 'Open Google Messages in a Chrome tab first, then try again.' });
        if (msg.focus !== false) {
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
        }
        reply(await sendToTab(tab, msg.message));
      }).catch((e) => reply({ ok: false, error: e.message }));
      return true;
    case 'gm-guard':
      // Stops the Messages page opening new tabs or windows (e.g. a map link)
      // while a backup runs. Has to run in the page's own JavaScript world.
      if (sender.tab?.id != null) {
        chrome.scripting.executeScript({
          target: { tabId: sender.tab.id },
          world: 'MAIN',
          args: [!!msg.on],
          func: (on) => {
            if (!window.__gmOpen) window.__gmOpen = window.open;
            window.open = on ? () => null : window.__gmOpen;
          },
        }).catch(() => {});
      }
      return false;
    case 'gm-badge':
      chrome.action.setBadgeText({ text: msg.text || '' });
      chrome.action.setBadgeBackgroundColor({ color: '#0b57d0' });
      return false;
    case 'gm-done':
      chrome.action.setBadgeText({ text: msg.ok ? '✓' : '!' });
      chrome.action.setBadgeBackgroundColor({ color: msg.ok ? '#146c2e' : '#b3261e' });
      getSettings().then((s) => { if (s.notify !== false) notify(msg.title, msg.message); });
      return false;
    case 'gm-backup-status':
      // Manual backups update the backup list's status too (`statusOnly`:
      // scheduled runs, whose list entries runDue updates itself).
      (async () => {
        const s = await getSettings();
        const now = Date.now();
        const byId = new Map(msg.results.map((r) => [r.id, r]));
        // Every chat's latest status, for the popup (on the backup list or not).
        const { chatStatus = {} } = await chrome.storage.local.get('chatStatus');
        for (const r of msg.results) chatStatus[r.id] = { title: r.title, complete: r.complete, count: r.count, oldest: r.oldest, status: r.status, ...(r.media ? { media: r.media } : {}), at: now };
        await chrome.storage.local.set({ chatStatus });
        if (msg.statusOnly) return;
        await saveSettings({ schedules: s.schedules.map((j) => {
          const r = byId.get(j.id);
          return r ? { ...j, title: r.title || j.title, lastRun: now, lastTried: now, lastOk: true, complete: r.complete, count: r.count, oldest: r.oldest, status: r.status || null, lastAdded: r.added,
            lastResult: `${r.status === 'messages' ? 'Messages backed up, photos to fetch' : r.complete ? 'Backed up' : 'Partly backed up'}: ${r.count} messages` } : j;
        }) });
      })();
      return false;
    case 'gm-own-window':
      if (!sender.tab) return false;
      ownWindow(sender.tab).then(reply, (e) => reply({ moved: false, error: e.message }));
      return true;
    case 'gm-restore-window':
      if (!sender.tab) return false;
      restoreWindow(sender.tab).then((restored) => reply({ restored }), () => reply({ restored: false }));
      return true;
    case 'gm-keep-visible':
      if (!sender.tab) return false;
      keepVisible(sender.tab).then(reply, () => reply({ changed: false }));
      return true;
    case 'gm-open-backup':
      // "Open my backup": the viewer, reading straight from the backup folder.
      // A hash opens a view in it, e.g. #labels/<chat ID> for one chat's labels.
      chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?library=1${/^[\w/%.-]*$/.test(msg.hash || '') && msg.hash ? `#${msg.hash}` : ''}`) });
      return false;
    case 'gm-open-messages':
      // Brings an open Google Messages tab forward, or opens one.
      messagesTab().then(async (tab) => {
        if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
        else await chrome.tabs.create({ url: 'https://messages.google.com/web/conversations' });
        reply({ ok: true });
      });
      return true;
    case 'gm-open-settings':
      chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${msg.hash ? `#${msg.hash}` : ''}`) });
      return false;
    case 'gm-clear-badge':
      chrome.action.setBadgeText({ text: '' });
      return false;
  }
  return false;
});
