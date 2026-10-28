// Message Archivist as an app of its own: installed by Chrome or Edge from its
// web address, opening in its own window (see notes/Modules/App.md). Its
// pages are the extension's own: Settings as the home page, with the viewer (your archive) as its first tab,
// put together by scripts/build-app.mjs. This file is loaded first in each,
// in <head>, and stands in for the few extension APIs those pages use:
//   chrome.storage.local        settings, past runs, the names you're known by in
//                               exports: kept in this app's IndexedDB
//   chrome.runtime.sendMessage  going between the archive and Settings; whatever needs a
//                               Google Messages tab answers that the extension does it
//   chrome.runtime.getManifest  the app's version
//   chrome.tabs.create          a window of the app
// and adds what only an app has: the install button, phone backups the
// system opens with it (File Handling), the copy kept for offline use
// (sw.js), and saying when a new version is ready.
(() => {
  if (globalThis.chrome?.runtime?.id) return; // the extension's own pages: nothing to stand in for
  const VERSION = '__VERSION__';
  const root = document.documentElement;
  // The viewer inside Settings' Archive tab: the page around it has the install button and notices.
  const framed = window !== window.top;
  root.classList.add('app');
  // One window: the archive is Settings' Archive tab, so "Open my backup" goes
  // there in this window (a hash change when it's already the page).
  const go = (url) => {
    const to = new URL(url, location.href);
    if (to.pathname === location.pathname) { if (to.hash !== location.hash) location.hash = to.hash; } else location.assign(to.href);
  };

  // ---------- chrome.storage.local, in IndexedDB ----------
  const db = new Promise((resolve, reject) => {
    const req = indexedDB.open('ma-app', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('storage');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const done = (t) => new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = t.onabort = () => reject(t.error); });
  async function everything() {
    const t = (await db).transaction('storage');
    const out = {};
    const req = t.objectStore('storage').openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } };
    await done(t);
    return out;
  }
  const listeners = [];
  const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel('ma-storage') : null;
  const tell = (changes) => { for (const fn of listeners) { try { fn(changes, 'local'); } catch (e) { console.error(e); } } };
  if (channel) channel.onmessage = (e) => tell(e.data);
  async function change(write) {
    const before = await everything();
    const t = (await db).transaction('storage', 'readwrite');
    const changes = write(t.objectStore('storage'), before);
    await done(t);
    if (Object.keys(changes).length) { tell(changes); channel?.postMessage(changes); }
  }
  const storage = {
    local: {
      async get(keys) {
        const all = await everything();
        if (keys == null) return all;
        if (typeof keys === 'string') return keys in all ? { [keys]: all[keys] } : {};
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]]));
        return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in all ? all[k] : d]));
      },
      set: (items) => change((store, before) => {
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          if (v === undefined) continue;
          const value = JSON.parse(JSON.stringify(v)); // as chrome.storage keeps it
          store.put(value, k);
          changes[k] = { oldValue: before[k], newValue: value };
        }
        return changes;
      }),
      remove: (keys) => change((store, before) => {
        const changes = {};
        for (const k of [].concat(keys)) if (k in before) { store.delete(k); changes[k] = { oldValue: before[k] }; }
        return changes;
      }),
    },
    onChanged: { addListener: (fn) => listeners.push(fn), removeListener: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } },
  };

  // ---------- messages to the extension's background worker ----------
  // The two the app does itself; the rest need Google Messages, which only the
  // extension can read.
  const EXT_ONLY = 'That’s for Message Archivist for Chrome, the extension, with Google Messages open in a tab: do it there. It backs up into this same folder, and the app shows what it saved.';
  async function sendMessage(msg) {
    if (msg?.type === 'gm-open-backup') { go(`./#archive${msg.hash ? `/${msg.hash}` : ''}`); return { ok: true }; }
    if (msg?.type === 'gm-open-settings') { go(`./${msg.hash ? `#${msg.hash}` : ''}`); return { ok: true }; }
    return { ok: false, error: EXT_ONLY };
  }

  globalThis.chrome = {
    storage,
    runtime: {
      id: undefined,
      getManifest: () => ({ manifest_version: 3, name: 'Message Archivist', version: VERSION }),
      getURL: (path) => new URL(path, location.href).href,
      sendMessage,
      onMessage: { addListener() {} },
    },
    tabs: { create: ({ url }) => { if (/viewer\.html/.test(url)) go(`./#archive${new URL(url, location.href).hash.replace('#', '/')}`); else window.open(url, '_blank'); } },
  };

  // ---------- what only the app has ----------
  const waiting = [];
  let takeFiles = null;
  window.MA_APP = {
    version: VERSION,
    // What goes into the backup folder beside index.html: the viewer as the
    // extension ships it, without this file or the app's address in it.
    archiveURL: (file) => new URL(file === 'viewer.html' ? 'archive/viewer.html' : file, location.href).href,
    // Phone backups the system opened with the app ("Open with", or a double
    // click once it's the default): Settings brings them in.
    onFiles(fn) { takeFiles = fn; while (waiting.length) fn(waiting.shift()); },
  };
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer((params) => {
      if (!params.files?.length) return;
      if (takeFiles) takeFiles(params.files); else waiting.push(params.files);
    });
  }

  // A line at the bottom of the window, with an optional button.
  function notice(text, label, onClick) {
    const show = () => {
      document.getElementById('maNotice')?.remove();
      const n = document.createElement('div');
      n.id = 'maNotice';
      n.setAttribute('role', 'status');
      n.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;margin:0 auto;max-width:560px;z-index:100;display:flex;gap:12px;align-items:center;padding:12px 16px;border-radius:16px;background:var(--surface-3, #333);color:var(--text, #fff);box-shadow:var(--shadow-2, 0 2px 8px rgba(0,0,0,.3));font:14px/20px var(--font, system-ui)';
      const t = document.createElement('span');
      t.style.flex = '1';
      t.textContent = text;
      n.append(t);
      if (label) { const b = document.createElement('button'); b.className = 'tonal small'; b.textContent = label; b.onclick = onClick; n.append(b); }
      const x = document.createElement('button');
      x.className = 'icon';
      x.setAttribute('aria-label', 'Close');
      x.textContent = '✕';
      x.onclick = () => n.remove();
      n.append(x);
      document.body.append(n);
    };
    if (document.body) show(); else addEventListener('DOMContentLoaded', show, { once: true });
  }

  // Install: Chrome and Edge offer it in the address bar too; this is a button
  // for it in either page's header, until the app is installed.
  let installEvent = null;
  const installed = () => matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay)').matches;
  function installButton() {
    if (framed || !installEvent || installed() || document.getElementById('maInstall')) return;
    const b = document.createElement('button');
    b.id = 'maInstall';
    b.className = 'tonal small';
    b.textContent = 'Install the app';
    b.title = 'Opens Message Archivist in its own window, with its own icon, without a browser tab';
    b.onclick = async () => {
      installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      if (outcome === 'accepted') { installEvent = null; b.remove(); }
    };
    const theme = document.getElementById('themeBtn');
    theme?.parentElement.insertBefore(b, theme);
  }
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', installButton, { once: true }); else installButton();
  });
  addEventListener('appinstalled', () => { installEvent = null; document.getElementById('maInstall')?.remove(); });

  // The copy for offline use. A new version waits until every window of the
  // app is closed, so nothing changes mid-way; "Restart now" brings it in.
  if ('serviceWorker' in navigator && !framed) {
    addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        const ready = () => notice('A new version of Message Archivist is ready. It starts the next time you open the app.', 'Restart now', () => {
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
          reg.waiting?.postMessage('skip-waiting');
        });
        if (reg.waiting && navigator.serviceWorker.controller) ready();
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ready(); });
        });
      } catch { /* no offline copy (a private window, say): the app still works online */ }
    });
  }
})();
