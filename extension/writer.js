// Runs in a small frame the exporter adds to the Messages tab. It owns the
// backup folder chosen in Settings (the folder belongs to the extension, not
// to messages.google.com) and does all reading and writing there. The page's
// content script talks to it over a private MessageChannel.
(() => {
  const ALLOWED = ['https://messages.google.com', location.origin];
  let port = null;
  let dir = null;

  function idbGet(key) {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('gm-exporter', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('kv');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const req = open.result.transaction('kv').objectStore('kv').get(key);
        req.onsuccess = () => { open.result.close(); resolve(req.result); };
        req.onerror = () => reject(req.error);
      };
    });
  }

  async function folder() {
    if (!dir) dir = await idbGet('backupDir');
    return dir;
  }

  async function locate(path, create) {
    const parts = path.split('/');
    let d = await folder();
    if (!d) throw new Error('No backup folder is set.');
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create });
    return [d, parts[parts.length - 1]];
  }

  const ops = {
    async status() {
      const d = await folder();
      return d ? { folder: d.name, permission: await d.queryPermission({ mode: 'readwrite' }) } : { folder: null };
    },
    async exists({ path }) {
      try { const [d, n] = await locate(path, false); await d.getFileHandle(n); return true; } catch { return false; }
    },
    async readText({ path }) {
      const [d, n] = await locate(path, false);
      return (await (await d.getFileHandle(n)).getFile()).text();
    },
    async write({ path, data }) {
      const [d, n] = await locate(path, true);
      const w = await (await d.getFileHandle(n, { create: true })).createWritable();
      await w.write(data);
      await w.close();
      return true;
    },
    // Deletes a file, or a folder and everything in it (missing is fine).
    async remove({ path }) {
      try { const [d, n] = await locate(path, false); await d.removeEntry(n, { recursive: true }); return true; } catch (e) { if (e.name === 'NotFoundError') return false; throw e; }
    },
    // Joins every chat's messages.csv into one file without the text passing
    // through the page: each chat's file is a slice of the new one, minus its
    // own BOM and header row after the first. Returns the new file's SHA-256.
    async joinCsv({ out, parts }) {
      const blobs = [];
      for (const p of parts) {
        let f;
        try { const [d, n] = await locate(p, false); f = await (await d.getFileHandle(n)).getFile(); } catch { continue; }
        if (!blobs.length) { blobs.push(f); continue; }
        const head = await f.slice(0, 8192).text();
        const nl = head.indexOf('\n');
        blobs.push(f.slice(nl < 0 ? f.size : new TextEncoder().encode(head.slice(0, nl + 1)).length));
      }
      const blob = new Blob(blobs, { type: 'text/csv' });
      const [d, n] = await locate(out, true);
      const w = await (await d.getFileHandle(n, { create: true })).createWritable();
      await w.write(blob);
      await w.close();
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
      return { sha256: [...hash].map((b) => b.toString(16).padStart(2, '0')).join(''), size: blob.size };
    },
    // Fetches a photo or video the Messages page isn't allowed to read (another
    // site, no CORS). This frame is an extension page with the extension's site
    // permissions, and the file goes back to the page as a Blob: no base64, no
    // size limit. Other websites only if Settings allowed them.
    async fetch({ url }) {
      if (!(await chrome.permissions.contains({ origins: [`${new URL(url).origin}/*`] }))) return { blocked: true };
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { blob: await res.blob() };
    },
    // What a folder holds: [{ name, kind }] (empty if it doesn't exist).
    async list({ path }) {
      let d = await folder();
      try { for (const p of path.split('/').filter(Boolean)) d = await d.getDirectoryHandle(p); } catch { return []; }
      const out = [];
      for await (const [name, h] of d.entries()) out.push({ name, kind: h.kind });
      return out;
    },
    // Shows the "Allow access" card; resolves once the user answers.
    async ask() {
      const d = await folder();
      document.getElementById('folder').textContent = d?.name || '';
      document.getElementById('ask').hidden = false;
      return new Promise((resolve) => {
        document.getElementById('allow').onclick = async () => {
          const state = await d.requestPermission({ mode: 'readwrite' });
          document.getElementById('ask').hidden = true;
          resolve(state);
        };
        document.getElementById('cancel').onclick = () => { document.getElementById('ask').hidden = true; resolve('denied'); };
      });
    },
  };

  addEventListener('message', (e) => {
    if (port || e.source !== parent || !ALLOWED.includes(e.origin) || e.data?.type !== 'gm-writer-init' || !e.ports[0]) return;
    port = e.ports[0];
    port.onmessage = async ({ data: { id, op, args } }) => {
      try {
        port.postMessage({ id, ok: true, result: await ops[op](args || {}) });
      } catch (err) {
        port.postMessage({ id, ok: false, error: err.message, name: err.name });
      }
    };
    port.postMessage({ id: 0, ok: true, result: 'ready' });
  });
})();
