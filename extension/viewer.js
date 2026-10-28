// The Message Archivist viewer. Runs from an export folder (reading data.js next to
// it) or inside the extension's live analyzer (data posted in by the page).
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nf = (n) => Number(n).toLocaleString();
  const plural = (n, w) => `${nf(n)} ${w}${n === 1 ? '' : 's'}`;
  const pad = (n) => String(n).padStart(2, '0');
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY = 86400000;
  const monthLabel = (k) => !k ? '' : k === 'undated' ? 'Undated' : `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
  const shortMonth = (k) => `${MONTHS[+k.slice(5, 7) - 1].slice(0, 3)} ${k.slice(0, 4)}`;
  // A backup folder whose index.html was copied by a backup run from before
  // library.js went beside it (an extension updated on disk but not reloaded):
  // say so and how it's fixed, rather than show nothing.
  if (!globalThis.GMLib) {
    gate('This copy of the viewer is missing a file', 'library.js isn’t next to it, so it can’t open your backup here. “Open my backup” in the extension still works. Reload the extension in chrome://extensions and run any backup (or bring anything in from Settings), and the file is put back. Your messages are all there.');
    return;
  }
  // Opened from the extension ("Open my backup"), files are read straight from
  // the backup folder; their addresses are filled in once read (see below).
  // The app (app/app.js) has no data.js of its own: it always reads the folder.
  const APP = !!window.MA_APP;
  const LIBRARY = new URLSearchParams(location.search).has('library') || APP;
  // The Archive tab of Settings (options.html) shows this page in a frame: its
  // tabs, logo and theme switch are Settings' own, and Settings is the page
  // around it, asked by message.
  const EMBEDDED = LIBRARY && new URLSearchParams(location.search).has('embedded') && parent !== window;
  if (EMBEDDED) document.documentElement.classList.add('embedded');
  const toSettings = (hash) => (EMBEDDED ? parent.postMessage({ type: 'ma-settings', hash }, location.origin) : chrome.runtime.sendMessage({ type: 'gm-open-settings', hash }));
  const mediaUrl = (f) => LIBRARY ? `gmlib:${encodeURIComponent(f)}` : f.split('/').map(encodeURIComponent).join('/');
  const parseTs = (t) => t ? new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10), +(t.slice(11, 13) || 0), +(t.slice(14, 16) || 0)).getTime() : null;
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fmtDay = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  const fmtTime = (m) => m.t && m.t.length > 10 ? new Date(m.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';
  const fmtWhen = (m) => m.ts ? `${fmtDate(m.ts)}${m.t.length > 10 ? ', ' + fmtTime(m) : ''}` : 'Undated';
  const fmtDur = (ms) => ms == null ? '—' : ms < 60000 ? `${Math.round(ms / 1000)} sec` : ms < 3600000 ? `${Math.round(ms / 60000)} min` : ms < 2 * DAY ? `${(ms / 3600000).toFixed(1)} hr` : `${(ms / DAY).toFixed(1)} days`;
  const hourLabel = (h) => h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
  // A coloured circle with the person's initial, like Google Messages. Numbers get "#".
  const initial = (name) => (/^[\s+(\d]/.test(name || '') ? '#' : ((name || '').match(/[\p{L}\p{N}]/u)?.[0] || '#'));
  // Contact photos saved with the export replace the initial where available.
  const PHOTOS = new Map();
  const avatar = (name, color, size = '') => PHOTOS.has(name)
    ? `<img class="avatar ${size}" src="${esc(PHOTOS.get(name))}" alt="" style="object-fit:cover">`
    : `<span class="avatar ${size}" style="background:${color || 'var(--outline)'}" aria-hidden="true">${esc(initial(name))}</span>`;
  const debounce = (fn, ms = 180) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
  const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
  const PHONE_RE = /(?:\+?\(?\d[\d\s().-]{8,}\d)/g;

  // ---------- load data ----------
  if (LIBRARY) {
    openLibrary();
  } else if (new URLSearchParams(location.search).has('embed')) {
    addEventListener('message', (e) => {
      // Only the page that embeds the analyzer (the Messages tab) may hand it data.
      if (parent !== window && e.source === parent && e.data?.type === 'gm-data') boot(e.data.data);
    });
  } else {
    const s = document.createElement('script');
    s.src = 'data.js';
    s.onload = () => {
      // Labels and folders, if any were made (labels.js sits next to data.js).
      const l = document.createElement('script');
      l.src = 'labels.js';
      l.onload = l.onerror = () => {
        // Who's who (people.js), the same way.
        const p = document.createElement('script');
        p.src = 'people.js';
        p.onload = p.onerror = () => {
          // And the phone's address book (contacts.js), which ties chats to contacts.
          const c = document.createElement('script');
          c.src = 'contacts.js';
          c.onload = c.onerror = () => loadChats(window.GM_EXPORT).then(boot);
          document.head.append(c);
        };
        document.head.append(p);
      };
      document.head.append(l);
    };
    s.onerror = () => boot(null);
    document.head.append(s);
  }

  // From version 4 each chat's messages are in its own chat.js, next to its
  // messages.json, so a backup only rewrites the chats it changed.
  function loadChats(D) {
    const todo = (D?.conversations || []).filter((c) => !c.messages && c.file);
    if (!todo.length) return Promise.resolve(D);
    const meta = document.querySelector('#meta');
    if (meta) meta.textContent = `Loading ${plural(todo.length, 'chat')}…`;
    return Promise.all(todo.map((c) => new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = mediaUrl(c.file);
      s.onload = s.onerror = resolve;
      document.head.append(s);
    }))).then(() => {
      for (const c of todo) {
        c.messages = window.GM_CHATS?.[c.folder];
        if (!c.messages) { c.messages = []; c.missingFile = true; }
      }
      return D;
    });
  }
  // ---------- "Open my backup" ----------
  // The extension remembers the backup folder (in its own storage), so its
  // viewer can open it directly: no need to find index.html on disk.
  let LIB_DIR = null;
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
  async function libFile(path) {
    let d = LIB_DIR;
    const parts = path.split('/');
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    return (await d.getFileHandle(parts[parts.length - 1])).getFile();
  }
  const libText = async (path) => { try { return await (await libFile(path)).text(); } catch { return null; } };
  async function libWrite(path, text) {
    if ((await LIB_DIR.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await LIB_DIR.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Chrome didn’t allow saving to your backup folder.');
    const w = await (await LIB_DIR.getFileHandle(path, { create: true })).createWritable();
    await w.write(text);
    await w.close();
  }

  // A message in the middle of the page, with an optional button.
  function gate(title, text, label, onClick) {
    document.getElementById('gm-gate')?.remove();
    const g = document.createElement('div');
    g.id = 'gm-gate';
    g.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:var(--surface);z-index:50;padding:16px';
    g.innerHTML = `<div style="max-width:440px;padding:28px;border-radius:28px;background:var(--bg);box-shadow:var(--shadow-2)"><div style="font-size:40px">💬</div><h2 style="margin:8px 0">${esc(title)}</h2><p class="gray">${esc(text)}</p>${label ? `<button class="filled" id="gateBtn">${esc(label)}</button>` : ''}</div>`;
    document.body.append(g);
    if (label) g.querySelector('#gateBtn').onclick = onClick;
  }

  async function openLibrary() {
    const dir = await idbGet('backupDir').catch(() => null);
    if (!dir) {
      // With no folder yet, the setup steps are on Settings' Home.
      if (EMBEDDED) toSettings('home');
      else if (APP) location.replace('./#welcome');
      else gate('No backup yet', 'Choose a backup folder in the extension’s Settings first, then back up a chat.');
      return;
    }
    if ((await dir.queryPermission({ mode: 'read' })) !== 'granted') {
      gate('Open your backup', `Chrome needs your OK to open your backup folder, “${dir.name}”. Click below and choose Allow.`, 'Open my backup', async () => {
        if ((await dir.requestPermission({ mode: 'read' })) === 'granted') loadLibrary(dir);
      });
      return;
    }
    loadLibrary(dir);
  }

  async function loadLibrary(dir) {
    LIB_DIR = dir;
    gate('Opening your backup…', `Reading “${dir.name}”.`);
    const text = await libText('data.js');
    if (!text) { gate('Nothing backed up yet', APP ? 'Bring in a phone backup or another app’s chats (Home → Tools → Bring in files…), or back up from Google Messages with the extension. It will show up here.' : 'Open a chat in Google Messages, click the 💬 extension icon and choose “Back up this chat”. It will show up here.'); return; }
    const D = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    for (const c of D.conversations || []) {
      if (c.messages || !c.file) continue;
      const t = await libText(c.file);
      try { c.messages = JSON.parse(t.slice(t.indexOf('] = ') + 4, t.lastIndexOf(';'))); } catch { c.messages = []; c.missingFile = true; }
    }
    try { window.GM_LABELS = JSON.parse((await libText('labels.json')) || 'null'); } catch { /* none yet */ }
    try { window.GM_PEOPLE = JSON.parse((await libText('people.json')) || 'null'); } catch { /* none yet */ }
    try { window.GM_CONTACTS = JSON.parse((await libText('contacts.json')) || 'null'); } catch { /* none */ }
    document.title = `${dir.name} · Message Archivist`;
    // Photos and videos are read from the folder as they appear on screen.
    const urls = new Map();
    const fill = (el, attrs = ['src', 'href']) => {
      for (let a of attrs) {
        const v = el.getAttribute?.(a);
        if (!v?.startsWith('gmlib:')) continue;
        const [path, hash] = v.slice(6).split('#');
        const f = decodeURIComponent(path);
        el.removeAttribute(a);
        if (a === 'data-gmlib') a = 'src';
        if (!urls.has(f)) urls.set(f, libFile(f).then((file) => URL.createObjectURL(file)).catch(() => ''));
        urls.get(f).then((u) => { if (u) el.setAttribute(a, u + (hash ? `#${hash}` : '')); });
      }
    };
    // A picture is looked up in the folder only when it comes near the screen,
    // so a chat or gallery with thousands of photos doesn't touch them all.
    // Watched by month (a picture inside a month the browser is skipping
    // with content-visibility can't tell whether it's near the screen itself).
    const waiting = new Map(); // month section (or the element itself) -> pictures
    const near = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        near.unobserve(e.target);
        for (const el of waiting.get(e.target) || []) fill(el, ['data-gmlib']);
        waiting.delete(e.target);
      }
    }, { rootMargin: '600px' });
    const later = (el) => {
      const v = el.getAttribute?.('src');
      if (!v?.startsWith('gmlib:')) { fill(el); return; }
      // Parked where the browser won't try to load it, until it's near.
      el.setAttribute('data-gmlib', v);
      el.removeAttribute('src');
      const box = el.closest('section.month') || el;
      if (!waiting.has(box)) { waiting.set(box, []); near.observe(box); }
      waiting.get(box).push(el);
    };
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') later(m.target);
        for (const n of m.addedNodes) if (n.nodeType === 1) { later(n); n.querySelectorAll('[src^="gmlib:"], [href^="gmlib:"]').forEach(later); }
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href'] });
    // Settings → Order of chats and people: where the Chats and People lists start.
    try {
      const sort = GMLib.normalizeSettings((await chrome.storage.local.get('settings')).settings).chatSort;
      if (sort !== 'auto') { $('#convSort').value = sort; $('#pplSort').value = sort; $('#ctSort').value = sort; }
    } catch { /* no settings to read */ }
    document.getElementById('gm-gate')?.remove();
    boot(D);
    document.querySelectorAll('[src^="gmlib:"], [href^="gmlib:"]').forEach(later);
  }

  const STATUS = { verified: ['ok', 'Verified complete'], complete: ['ok', 'Complete'], phone: ['ok', 'From phone'], messages: ['ok', 'Messages saved, photos to fetch'], incomplete: ['warn', 'Unfinished'], problem: ['bad', 'Needs attention'] };
  const statusPill = (c) => {
    const [k, label] = c.missingFile ? ['bad', 'chat.js missing'] : STATUS[c.status] || [];
    return label ? `<span class="st ${k}" title="${esc((c.problems || []).join(', '))}">${label}</span>` : '';
  };

  const personColor = (name) => {
    if (name === 'Me') return 'var(--c1)';
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return `var(--c${2 + (h % 7)})`;
  };

  // ---------- phone numbers ----------
  // GMLib's (library.js): "(555) 020-0001" in North America, "+44 770 090
  // 0123" elsewhere; short codes, names and anything too long to be one
  // number stay as they are.
  const fmtNumber = GMLib.formatNumber;
  const isNumberName = GMLib.isNumberName;

  // The app each chat came from: text messages unless the index says
  // otherwise. One archive holds every app's conversations; each app's name
  // and colour come from its module (modules/, GMLib.SERVICES).
  const appOf = (c) => c?.service || 'sms';
  const appName = (a) => GMLib.SERVICES[a]?.label || a;
  const appColor = (a) => GMLib.SERVICES[a]?.color || '#888';
  // A source: an app, or a second account in one ("Google Messages · (555) 010-0199").
  const srcKey = (c) => `${appOf(c)}|${c?.account || ''}`;
  const srcName = (c) => `${appName(appOf(c))}${c?.account ? ` · ${c.account_label || c.account}` : ''}`;
  const isMainSms = (c) => appOf(c) === 'sms' && !c?.account;
  // Main Google Messages chats get a badge only when Google Messages has a second account.
  let MULTI_SMS = false;
  const appBadge = (c) => (isMainSms(c) && !MULTI_SMS ? '' : ` <span class="app-badge" style="--app:${appColor(appOf(c))}">${esc(srcName(c))}</span>`);
  // The colour of an app's badges and dots.
  const appDots = (services) => `<span class="src-dots" title="${esc(services.map(appName).join(', '))}">${services.map((a) => `<span class="dot" style="--app:${appColor(a)}"></span>`).join('')}</span>`;

  // ---------- reactions sent as texts ----------
  // Where a reaction can't travel as one (to a phone without RCS, or as the
  // phone itself stores it), it's a text: `❤️ to “See you soon”`,
  // `Reacted 😂 to “…”`, an iPhone's `Loved “…”`. Those are shown on the
  // message they're about, as Google Messages does, not as messages of their
  // own; the backup's files keep them as they came.
  const EMOJI = '(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator})(?:[\\p{Extended_Pictographic}\\p{Emoji_Modifier}\\p{Regional_Indicator}\\u200d\\ufe0f\\u20e3])*';
  const QUOTED = '[“"„«]\\s*([\\s\\S]*?)\\s*[”"“»]';
  const MEDIA_WORD = '(an? (?:image|photo|picture|video|gif|GIF|sticker|attachment|audio message|voice message))';
  const EMOJI_RE = new RegExp(EMOJI, 'u');
  const RX_ADD = new RegExp(`^(?:Reacted\\s+)?(${EMOJI})\\s+to\\s+(?:${QUOTED}|${MEDIA_WORD})$`, 'u');
  const RX_TAP = new RegExp(`^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned)\\s+(?:${QUOTED}|${MEDIA_WORD})$`, 'u');
  const RX_DEL = new RegExp(`^Removed\\s+(${EMOJI}|a heart|a like|a dislike|a laugh|an exclamation(?: mark)?|a question mark)\\s+from\\s+(?:${QUOTED}|${MEDIA_WORD})$`, 'u');
  const TAPBACK = { loved: '❤️', liked: '👍', disliked: '👎', 'laughed at': '😂', emphasized: '‼️', questioned: '❓', 'a heart': '❤️', 'a like': '👍', 'a dislike': '👎', 'a laugh': '😂', 'an exclamation': '‼️', 'an exclamation mark': '‼️', 'a question mark': '❓' };
  function reactionOf(text) {
    let r = text.length < 1000 && (RX_ADD.exec(text) || RX_TAP.exec(text));
    const remove = !r && text.length < 1000 && (r = RX_DEL.exec(text));
    if (!r) return null;
    return { e: TAPBACK[r[1].toLowerCase()] || r[1], quote: r[2] ?? null, media: !!r[3], remove: !!remove };
  }
  const normQ = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  // Each reaction goes on the nearest earlier message it quotes (a quote may
  // be cut short with "…"), or for "to an image", the nearest with a photo.
  function foldReactions(c) {
    const msgs = c.messages;
    for (let k = 0; k < msgs.length; k++) {
      const m = msgs[k];
      if (!m.x || m.m.length) continue;
      const r = reactionOf(m.x);
      if (!r) continue;
      const q = r.quote != null ? normQ(r.quote) : null;
      const cut = q && /(…|\.\.\.)$/.test(q) ? q.replace(/(…|\.\.\.)$/, '').trim() : null;
      let target = null;
      for (let j = k - 1; j >= 0 && j >= k - 1000 && !target; j--) {
        const t = msgs[j];
        if (t.rxOf) continue;
        if (r.media ? t.m.length > 0 : q === normQ(t.x) || (cut && normQ(t.x).startsWith(cut))) target = t;
      }
      if (!target) continue;
      m.rxOf = target;
      target.rx ||= [];
      if (r.remove) {
        const i = target.rx.findIndex((x) => x.s === m.s && (x.e === r.e || !/\p{Extended_Pictographic}/u.test(r.e)));
        if (i >= 0) target.rx.splice(i, 1);
      } else target.rx.push({ e: r.e, s: m.s, t: m.t });
    }
  }

  let booted = false;
  function boot(D) {
    if (booted) return;
    booted = true;
    D = D || { conversations: [], skipped: [] };
    window.GMTheme?.bind($('#themeBtn'));

    // ---------- codes, promotions and automated texts ----------
    // Chats of one-time codes, promotions and spam, and other automated texts
    // (GMLib.chatKind) are kept out of All chats, People, Search, Media and
    // Analysis, in folders of their own, unless "Show them everywhere" is on
    // (this browser remembers it). A chat the owner kept ("It's not", saved
    // as `keep` in labels.json) or labelled with anything but Spam is never one.
    const KINDS = { codes: { icon: '🔑', name: 'Codes', long: 'Verification codes' }, promos: { icon: '📣', name: 'Promotions', long: 'Promotions and spam' }, automated: { icon: '🤖', name: 'Automated', long: 'Other automated texts' } };
    let SHOW_ALL = false;
    try { SHOW_ALL = localStorage.getItem('ma-show-filtered') === '1'; } catch { /* storage blocked */ }
    {
      const labels = window.GM_LABELS || {};
      for (const c of D.conversations) {
        const key = c.id || c.folder || c.title;
        const ids = labels.chats?.[key] || [];
        c.kind = labels.keep?.[key] || ids.some((id) => id !== 'spam') ? null : GMLib.chatKind(c, GMLib.chatTraits(c.messages));
      }
    }
    const tucked = (c) => !!c.kind && !SHOW_ALL;

    // ---------- prepare data ----------
    const ALL = [];
    D.conversations.forEach((c, ci) => {
      c.ci = ci;
      // Numbers shown one way everywhere (the original kept for label keys).
      c.rawTitle = c.title;
      c.title = fmtNumber(c.title);
      for (const p of c.contact?.people || []) p.n = fmtNumber(p.n);
      const counts = new Map();
      for (const m of c.messages) {
        m.c = c;
        m.s = fmtNumber(m.s);
        if (m.r) m.r.s = fmtNumber(m.r.s);
        m.ts = parseTs(m.t);
        m.month = m.t ? m.t.slice(0, 7) : 'undated';
        m.m = m.m || [];
        m.x = m.x || '';
        m.lx = (m.x + (m.r ? '\n' + m.r.x : '')).toLowerCase();
        // Reactions Google Messages for Web showed on the message (labels such as "❤️ from Alex").
        if (m.rc) m.rx = m.rc.flatMap((label) => { const e = label.match(EMOJI_RE); return e ? [{ e: e[0], s: label, label: true }] : []; });
        counts.set(m.s, (counts.get(m.s) || 0) + 1);
        if (!tucked(c)) ALL.push(m);
      }
      c.people = [...counts].map(([name, n]) => ({ name, n })).sort((a, b) => (a.name === 'Me') - (b.name === 'Me') || b.n - a.n);
      // Several people wrote in it: names go on its messages. (c.group is what the index says.)
      c.multi = c.group === true || c.people.filter((p) => p.name !== 'Me').length > 1;
      // Colour follows the person everywhere: "Me" is slot 1, everyone else gets
      // one of slots 2–8 picked from their name, like Google Messages' avatars.
      c.color = new Map(c.people.map((p) => [p.name, personColor(p.name)]));
      const dated = c.messages.filter((m) => m.ts);
      c.first = dated[0]?.ts || null;
      c.last = dated[dated.length - 1]?.ts || null;
    });
    for (const c of D.conversations) {
      for (const p of c.contact?.people || []) {
        if (p.photo && !PHOTOS.has(p.n)) PHOTOS.set(p.n, p.photo.startsWith('data:') ? p.photo : mediaUrl(p.photo));
      }
      // A one-to-one chat's avatar is its contact's photo.
      const only = c.contact?.people?.length === 1 ? c.contact.people[0] : null;
      if (only?.photo && !PHOTOS.has(c.title)) PHOTOS.set(c.title, PHOTOS.get(only.n));
    }
    D.conversations.forEach((c) => c.messages.forEach((m, k) => { m.pos = k; }));
    D.conversations.forEach(foldReactions);

    // ---------- labels and folders ----------
    // Labels such as Favorites, Family or Spam, on whole chats and on single
    // messages. Each label is also a folder in the chat list; Spam is kept out
    // of "All chats". Opened with "Open my backup" they're saved in the backup
    // folder (labels.json, and labels.js so the folder's index.html shows them
    // too). They're notes of yours, so they aren't part of SHA256SUMS.txt.
    const DEFAULT_LABELS = [
      { id: 'favorites', name: 'Favorites', icon: '⭐' },
      { id: 'family', name: 'Family', icon: '👪' },
      { id: 'friends', name: 'Friends', icon: '🙂' },
      { id: 'work', name: 'Work', icon: '💼' },
      { id: 'important', name: 'Important', icon: '❗' },
      { id: 'spam', name: 'Spam', icon: '🚫' },
    ];
    const LABELS = { version: 1, labels: DEFAULT_LABELS, chats: {}, messages: {}, ...(window.GM_LABELS || {}) };
    const canLabel = LIBRARY;
    const chatKey = (c) => c.id || c.folder || c.rawTitle || c.title;
    const msgLabelKey = (m) => `${chatKey(m.c)}|${m.id || m.i}`;
    const labelById = (id) => LABELS.labels.find((l) => l.id === id);
    // Favourites come first in every list of chats: pinned in Google Messages,
    // a starred contact on the phone, or labelled Favorites here. Then chats
    // with names, A–Z, then chats known only by a number.
    const favourite = (c) => !!(c.pinned || c.contact?.people?.some((p) => p.fav) || chatLabels(c).includes('favorites'));
    const chatOrder = (a, b) => favourite(b) - favourite(a) || isNumberName(a.title) - isNumberName(b.title)
      || a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
    const chatLabels = (c) => (LABELS.chats[chatKey(c)] || []).filter(labelById);
    const msgLabels = (m) => (LABELS.messages[msgLabelKey(m)] || []).filter(labelById);
    const labelChip = (id) => { const l = labelById(id); return l ? `<span class="lab-chip">${esc(l.icon)} ${esc(l.name)}</span>` : ''; };
    async function saveLabels() {
      LABELS.updated_at = new Date().toISOString();
      for (const k of ['chats', 'messages']) for (const [key, ids] of Object.entries(LABELS[k])) if (!ids.length) delete LABELS[k][key];
      if (!Object.keys(LABELS.flags || {}).length) delete LABELS.flags;
      const json = JSON.stringify(LABELS, null, 2);
      LABELS.flags = FLAGS;
      try {
        await libWrite('labels.json', json);
        await libWrite('labels.js', `window.GM_LABELS = ${JSON.stringify(LABELS)};\n`);
      } catch (e) {
        alert(`${e.message} Your label change shows now but wasn’t saved.`);
      }
    }
    // Flags: messages marked during review, with an optional note. Opened with
    // "Open my backup" they're saved in labels.json with the labels; otherwise
    // they're kept in this browser for this archive. Both are included in CSV
    // exports and printouts.
    const FLAG_KEY = `gm-flags:${D.exported_at || 'live'}:${D.conversations.map((c) => c.id).join(',').slice(0, 200)}`;
    const flagKey = (m) => `${m.c.id || m.c.ci}|${m.id || m.i}`;
    let local = {};
    try { local = JSON.parse(localStorage.getItem(FLAG_KEY) || '{}'); } catch { /* storage blocked */ }
    const FLAGS = LABELS.flags = { ...(LABELS.flags || {}) };
    // Flags made in this browser before they were saved in the backup are moved there.
    const moved = Object.keys(local).filter((k) => !FLAGS[k]);
    for (const k of moved) FLAGS[k] = local[k];
    const saveFlags = () => {
      if (canLabel) return saveLabels();
      try { localStorage.setItem(FLAG_KEY, JSON.stringify(FLAGS)); } catch { /* storage blocked */ }
    };
    if (canLabel && moved.length) saveLabels().then(() => { try { localStorage.removeItem(FLAG_KEY); } catch { /* storage blocked */ } });
    const flagOf = (m) => FLAGS[flagKey(m)];
    const BY_KEY = new Map(ALL.map((m) => [flagKey(m), m]));

    const toggleIn = (obj, key, id) => {
      const cur = new Set(obj[key] || []);
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      obj[key] = [...cur];
    };

    // Each photo and video's status, as in the chat's media-index.json. Chats saved
    // before 0.4.5.0 have none, so it's worked out from what was recorded.
    const MEDIA_ST = { full: 'Full size', same: 'Full size', thumbnail: 'Thumbnail', original: 'Saved as sent', waiting: 'Not fetched yet', failed: 'Couldn’t be saved', skipped: 'Not saved (by choice)', left: 'Left out (another copy kept)' };
    const mediaSt = (md) => md.st || (md.f ? (md.src === 'full-size viewer' ? 'full' : /same size as the full-size viewer/.test(md.src || '') ? 'same' : md.k === 'image' && /chat thumbnail/.test(md.src || '') ? 'thumbnail' : 'original')
      : md.skip ? 'skipped' : md.err ? 'failed' : 'waiting');
    const LEFT_WHY = { 'gif-preview': 'the still picture of a GIF that was saved', duplicate: 'a copy of a photo already saved in this message' };

    // People in lists: you, then favourites (starred contacts on the phone),
    // then names A–Z, then those known only by a number.
    const FAV_PEOPLE = new Set(D.conversations.flatMap((c) => (c.contact?.people || []).filter((p) => p.fav).map((p) => p.n)));
    const personOrder = (a, b) => (b === 'Me') - (a === 'Me') || FAV_PEOPLE.has(b) - FAV_PEOPLE.has(a) || isNumberName(a) - isNumberName(b)
      || a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
    const PEOPLE = [...new Set(ALL.map((m) => m.s))].sort(personOrder);
    const MEDIA_ALL = ALL.flatMap((m) => [...m.m.map((md, k) => ({ m, md, k, st: mediaSt(md) })), ...(m.lo || []).map((lo) => ({ m, md: { k: lo.k, w: lo.w, h: lo.h, why: lo.why }, k: -1, st: 'left' }))]);
    const MEDIA = MEDIA_ALL.filter((x) => x.md.f);

    $('#meta').textContent = `${plural(D.conversations.length, 'chat')} · ${plural(ALL.length, 'message')} · ${nf(MEDIA.length)} media` +
      `${D.live ? '' : ` · created ${D.exported_at ? fmtDate(Date.parse(D.exported_at)) : '?'}`}${D.updated_at && D.updated_at !== D.exported_at ? ` · updated ${fmtDate(Date.parse(D.updated_at))}` : ''}`;
    if (D.live) {
      $('#livebar').hidden = false;
      $('#livebar').textContent = `Live analysis read from Messages ${fmtDate(Date.parse(D.exported_at))}${D.range ? `, ${D.range.from} to ${D.range.to}` : ''}. Nothing has been saved; photos and videos aren’t loaded here.`;
    }

    // ---------- search helpers ----------
    // A term in quotes is whole words ("now" doesn't find "know"); one
    // without quotes can be part of a word ("photo" finds "photos").
    const WHOLE = '\u0001';
    const parseTerms = (q) => (q.match(/"[^"]+"|\S+/g) || []).map((t) => (t.startsWith('"') ? WHOLE : '') + t.replace(/"/g, '').toLowerCase()).filter((t) => t.replace(WHOLE, ''));
    const wordRes = new Map();
    const termPattern = (t, escape = (x) => x) => t.startsWith(WHOLE) ? `(?<![\\p{L}\\p{N}])${reEsc(escape(t.slice(1)))}(?![\\p{L}\\p{N}])` : reEsc(escape(t));
    const termIn = (s, t) => {
      if (!t.startsWith(WHOLE)) return s.includes(t);
      if (!wordRes.has(t)) wordRes.set(t, new RegExp(termPattern(t), 'u'));
      return wordRes.get(t).test(s);
    };
    const hasTerms = (m, terms) => terms.every((t) => termIn(m.lx, t));
    function hl(text, terms) {
      const out = esc(text);
      if (!terms.length) return out;
      const re = new RegExp(terms.map((t) => termPattern(t, esc)).sort((a, b) => b.length - a.length).join('|'), 'giu');
      return out.replace(re, (s) => `<mark>${s}</mark>`);
    }
    function snippet(m, terms) {
      const text = m.x || (m.m.length ? `[${m.m.map((x) => x.k).join(', ')}]` : '');
      if (!terms.length || text.length < 220) return hl(text, terms);
      const i = Math.min(...terms.map((t) => { const p = text.toLowerCase().search(new RegExp(termPattern(t), 'u')); return p < 0 ? Infinity : p; }));
      const start = Math.max(0, (isFinite(i) ? i : 0) - 70);
      return (start > 0 ? '…' : '') + hl(text.slice(start, start + 220), terms) + (start + 220 < text.length ? '…' : '');
    }
    const msgDetails = (m) => [
      fmtWhen(m),
      m.tr ? `Shown as: ${m.tr}` : null,
      m.p ? `Time is approximate (${m.p === 'section' ? 'from the date heading above' : m.p === 'day' ? 'date only' : 'unknown'})` : null,
      m.id ? `Message ID: ${m.id}` : null,
    ].filter(Boolean).join('\n');

    // ---------- tooltip ----------
    const tip = $('#tip');
    document.addEventListener('mousemove', (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (!el) { tip.style.display = 'none'; return; }
      tip.textContent = el.dataset.tip;
      tip.style.display = 'block';
      const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
      const y = e.clientY + 16 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 16;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    });

    // ---------- Google Photos-style scrubber ----------
    // Years are marked along the rail, dots mark months, and a pill shows the
    // month you're on while scrolling or dragging.
    function Scrubber(scrollEl, rail) {
      rail.innerHTML = '<div class="rail-marks"></div><div class="rail-thumb"></div><div class="rail-pill"></div><div class="rail-hover"></div>';
      const [marksEl, thumb, pill, hover] = rail.children;
      let marks = [];
      let lastH = -1;
      let dragging = false;
      let hideT;
      const usable = () => rail.clientHeight - 24;
      const maxScroll = () => Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight);
      function measure() {
        lastH = scrollEl.scrollHeight;
        marks = [...scrollEl.querySelectorAll('[data-month]')].map((s) => ({ k: s.dataset.month, top: s.offsetTop }));
        const H = usable();
        let html = '';
        let lastYear = null;
        let lastLabel = -99;
        let lastDot = -99;
        for (const m of marks) {
          const y = Math.min(1, m.top / maxScroll()) * H;
          const yr = m.k === 'undated' ? '—' : m.k.slice(0, 4);
          if (yr !== lastYear && y - lastLabel > 18) { html += `<span class="rail-year" style="top:${y}px">${yr}</span>`; lastLabel = y; lastDot = y; }
          else if (y - lastDot > 5 && y - lastLabel > 8) { html += `<i class="rail-dot" style="top:${y}px"></i>`; lastDot = y; }
          lastYear = yr;
        }
        marksEl.innerHTML = html;
        rail.hidden = scrollEl.scrollHeight <= scrollEl.clientHeight * 1.3;
        position(false);
      }
      const monthAt = (contentY) => {
        let lo = 0; let hi = marks.length - 1; let ans = 0;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (marks[mid].top <= contentY) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
        return marks[ans]?.k;
      };
      function position(showPill) {
        if (scrollEl.scrollHeight !== lastH) { measure(); if (!showPill) return; }
        const y = Math.min(1, scrollEl.scrollTop / maxScroll()) * usable();
        thumb.style.top = y + 'px';
        if (!showPill) return;
        pill.textContent = monthLabel(monthAt(scrollEl.scrollTop + 2));
        pill.style.top = y + 'px';
        pill.classList.add('show');
        clearTimeout(hideT);
        if (!dragging) hideT = setTimeout(() => pill.classList.remove('show'), 1200);
      }
      const fracAt = (e) => { const r = rail.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientY - r.top - 12) / (r.height - 24))); };
      const go = (e) => { scrollEl.scrollTop = fracAt(e) * maxScroll(); };
      rail.addEventListener('pointerdown', (e) => { dragging = true; rail.setPointerCapture(e.pointerId); hover.classList.remove('show'); go(e); });
      rail.addEventListener('pointermove', (e) => {
        if (dragging) { go(e); return; }
        const f = fracAt(e);
        hover.textContent = monthLabel(monthAt(f * maxScroll() + 2));
        hover.style.top = f * usable() + 'px';
        hover.classList.add('show');
      });
      rail.addEventListener('pointerleave', () => hover.classList.remove('show'));
      const end = () => { if (!dragging) return; dragging = false; position(true); };
      rail.addEventListener('pointerup', end);
      rail.addEventListener('pointercancel', end);
      let raf = 0;
      scrollEl.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; position(true); }); }, { passive: true });
      new ResizeObserver(() => measure()).observe(scrollEl);
      return { measure };
    }

    // ---------- conversation list ----------
    const state = { conv: null, folder: '', people: new Set(), mediaOnly: false, terms: [], hits: [], hit: -1 };

    // A chat's avatar takes the colour of its main contact.
    const convColor = (c) => c.color.get(c.people.find((p) => p.name !== 'Me')?.name) || 'var(--c2)';

    function renderConvList() {
      const q = $('#convFilter').value.trim().toLowerCase();
      const sort = $('#convSort').value;
      const app = $('#convApp').value;
      const list = D.conversations.filter((c) => (!q || c.title.toLowerCase().includes(q) || c.people.some((p) => p.name.toLowerCase().includes(q)))
        && (!app || srcKey(c) === app)
        && (state.folder.startsWith('kind:') ? c.kind === state.folder.slice(5)
          : state.folder ? chatLabels(c).includes(state.folder) : !chatLabels(c).includes('spam') && !tucked(c)));
      renderFolders();
      list.sort(sort === 'count' ? (a, b) => b.messages.length - a.messages.length
        : sort === 'name' ? chatOrder
        : (a, b) => (b.last || 0) - (a.last || 0));
      $('#convList').innerHTML = list.map((c) => {
        const last = c.messages.findLast((m) => !m.rxOf); // a reaction isn't the last message
        const snip = last ? `${last.s === 'Me' ? 'You: ' : c.multi ? last.s + ': ' : ''}${last.x || (last.m.length ? `[${last.m[0].k}]` : '')}` : '';
        return `<button class="conv${c === state.conv ? ' active' : ''}" data-ci="${c.ci}">${avatar(c.title, convColor(c))}<span class="conv-body">
          <span class="conv-top"><span class="conv-title">${esc(c.title)}${appBadge(c)}${c.pinned ? ' <span class="lab-ico" title="Pinned in Google Messages">📌</span>' : ''}${chatLabels(c).map((id) => ` <span class="lab-ico" title="${esc(labelById(id).name)}">${esc(labelById(id).icon)}</span>`).join('')}</span><span class="conv-date">${fmtDate(c.last)}</span></span>
          <span class="conv-snip" style="display:block">${esc(snip.slice(0, 120))}</span>
          <span class="conv-count">${plural(c.messages.length, 'message')}${c.multi ? ` · ${c.people.length} people` : ''}${c.status === 'incomplete' || c.status === 'problem' || c.missingFile ? ` · ${statusPill(c)}` : ''}</span></span></button>`;
      }).join('') || `<div class="empty">${!D.conversations.length ? 'No data found. Keep data.js and viewer.js next to this file.' : state.folder.startsWith('kind:') || (q && state.folder) ? 'No conversations match.' : state.folder ? `No chats labelled ${esc(labelById(state.folder)?.name || '')} yet. Open a chat and use 🏷 Labels.` : D.conversations.some((c) => chatLabels(c).includes('spam')) && !q ? 'Every chat here is labelled Spam: see the 🚫 Spam folder above.' : D.conversations.some(tucked) && !q ? 'Every chat here is codes, promotions or automated texts: see their folders above.' : 'No conversations match.'}</div>`;
    }
    // The folder bar: All chats, each label in use, then codes, promotions and
    // automated texts, and the switch that shows those everywhere.
    function renderFolders() {
      const count = (id) => D.conversations.filter((c) => chatLabels(c).includes(id)).length;
      const used = LABELS.labels.filter((l) => count(l.id));
      const kinds = Object.entries(KINDS).map(([k, v]) => [k, v, D.conversations.filter((c) => c.kind === k).length]).filter(([, , n]) => n);
      $('#folders').hidden = !used.length && !kinds.length && !state.folder;
      $('#folders').innerHTML = `<button class="chip${state.folder ? '' : ' on'}" data-folder="">All chats</button>` +
        used.map((l) => `<button class="chip${state.folder === l.id ? ' on' : ''}" data-folder="${esc(l.id)}">${esc(l.icon)} ${esc(l.name)} <span class="n">${count(l.id)}</span></button>`).join('') +
        kinds.map(([k, v, n]) => `<button class="chip${state.folder === `kind:${k}` ? ' on' : ''}" data-folder="kind:${k}" title="${esc(v.long)}${SHOW_ALL ? '' : ': kept out of All chats, People, Search, Media and Analysis'}">${v.icon} ${v.name} <span class="n">${nf(n)}</span></button>`).join('') +
        (kinds.length ? `<button class="chip" data-showall title="${SHOW_ALL ? 'Keep codes, promotions and automated texts in their folders only' : 'Show codes, promotions and automated texts in All chats, People, Search, Media and Analysis too'}">${SHOW_ALL ? 'Keep them apart' : 'Show them everywhere'}</button>` : '');
    }
    $('#folders').addEventListener('click', (e) => {
      if (e.target.closest('[data-showall]')) {
        try { localStorage.setItem('ma-show-filtered', SHOW_ALL ? '0' : '1'); } catch { /* storage blocked */ }
        location.reload();
        return;
      }
      const b = e.target.closest('[data-folder]');
      if (!b) return;
      state.folder = b.dataset.folder;
      renderConvList();
    });
    $('#convFilter').addEventListener('input', debounce(renderConvList, 120));
    $('#convSort').addEventListener('change', renderConvList);
    // The source filter (each app, and each second account in one), once there's more than one.
    {
      MULTI_SMS = new Set(D.conversations.filter((c) => appOf(c) === 'sms').map((c) => c.account || '')).size > 1;
      const sources = new Map();
      for (const c of D.conversations) sources.set(srcKey(c), { name: srcName(c), n: (sources.get(srcKey(c))?.n || 0) + 1, main: isMainSms(c) });
      $('#convApp').hidden = sources.size < 2;
      $('#convApp').innerHTML = `<option value="">All sources</option>${[...sources].sort((a, b) => b[1].main - a[1].main || a[1].name.localeCompare(b[1].name)).map(([k, v]) => `<option value="${esc(k)}">${esc(v.name)} (${v.n})</option>`).join('')}`;
      $('#convApp').addEventListener('change', renderConvList);
    }
    $('#chatBack').addEventListener('click', () => { location.hash = '#chat'; });
    $('#chatLabelsShown').addEventListener('click', (e) => {
      const g = e.target.closest('.also [data-goto]');
      if (g) openChat(+g.dataset.goto);
      // Not codes or spam after all: kept with the other chats from now on (labels.json `keep`).
      if (e.target.closest('[data-notkind]') && state.conv) {
        LABELS.keep = { ...(LABELS.keep || {}), [chatKey(state.conv)]: true };
        saveLabels().then(() => location.reload());
      }
    });

    // ---------- people ----------
    // One person across apps, accounts and numbers (GMLib.people): chats that
    // share a number, an email address or a handle are one person by
    // themselves; people with only a name in common are suggestions. What the
    // owner decides (the same person, not the same, a chat that isn't them, a
    // name) is people.json, saved in the backup folder like the labels, and
    // people.js, so the folder's index.html sees it too.
    let SAVED = GMLib.peopleSaved(window.GM_PEOPLE);
    const PEOPLE_ROWS = D.conversations.filter((c) => !tucked(c));
    let PPL = GMLib.people(PEOPLE_ROWS, SAVED, window.GM_CONTACTS || null);
    const personOf = (c) => PPL.byChat.get(GMLib.chatKey(c)) || null;
    const personByKey = (k) => PPL.list.find((p) => p.key === k) || PPL.byChat.get(k) || null;
    const matchesOf = (p) => PPL.suggestions.filter((x) => x.a === p || x.b === p).map((x) => (x.a === p ? x.b : x.a));
    // The person's other chats (in any app, or from another number), and chats
    // of people with the same name who aren't joined with them yet.
    const elsewhere = (c) => personOf(c)?.chats.filter((o) => o !== c) || [];
    const maybeElsewhere = (c) => { const p = personOf(c); return p ? matchesOf(p).flatMap((q) => q.chats) : []; };
    const idText = (id) => (id.startsWith('tel:') ? fmtNumber(id.slice(4)) : id.startsWith('email:') ? id.slice(6) : `${appName(id.slice(0, id.indexOf(':')))} ${id.slice(id.indexOf(':') + 1)}`);
    const pplState = { person: null, matches: false, msgs: [], shown: 0 };
    async function savePeople(next, keepChat) {
      SAVED = next;
      PPL = GMLib.people(PEOPLE_ROWS, SAVED, window.GM_CONTACTS || null);
      pplState.person = keepChat !== undefined ? (keepChat && PPL.byChat.get(keepChat)) || null : pplState.person && personByKey(pplState.person.key);
      renderPeopleList();
      renderPerson();
      try {
        await libWrite('people.json', JSON.stringify(SAVED, null, 2));
        await libWrite('people.js', `window.GM_PEOPLE = ${JSON.stringify(SAVED)};\n`);
      } catch (e) {
        alert(`${e.message} The change shows now but wasn’t saved.`);
      }
    }

    function renderPeopleList() {
      const q = $('#pplFilter').value.trim().toLowerCase();
      const digits = q.replace(/\D/g, '');
      const sort = $('#pplSort').value;
      const list = PPL.list.filter((p) => !q || [p.name, ...p.names].some((n) => n.toLowerCase().includes(q))
        || p.ids.some((id) => idText(id).toLowerCase().includes(q) || (digits.length >= 3 && id.startsWith('tel:') && id.includes(digits))));
      list.sort(sort === 'name' ? (a, b) => isNumberName(a.name) - isNumberName(b.name) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
        : sort === 'recent' ? (a, b) => (b.last || 0) - (a.last || 0)
        : sort === 'apps' ? (a, b) => b.services.length - a.services.length || b.count - a.count
        : (a, b) => b.count - a.count);
      const n = PPL.suggestions.length;
      $('#pplSuggest').hidden = !n;
      $('#pplSuggest').classList.toggle('on', pplState.matches);
      $('#pplSuggest').textContent = `${n === 1 ? 'Two people have' : `${nf(n)} pairs of people have`} the same name: are they the same person?`;
      $('#pplList').innerHTML = list.map((p) => `<button class="conv${p === pplState.person ? ' active' : ''}" data-key="${esc(p.key)}">${avatar(p.name, personColor(p.name))}<span class="conv-body">
        <span class="conv-top"><span class="conv-title">${esc(p.name)}${appDots(p.services)}</span><span class="conv-date">${fmtDate(p.last)}</span></span>
        <span class="conv-snip" style="display:block">${esc(p.ids.map(idText).filter((x) => x !== p.name).slice(0, 2).join(' · ') || p.names.filter((x) => x !== p.name).join(', '))}</span>
        <span class="conv-count">${plural(p.count, 'message')}${p.chats.length > 1 ? ` · ${p.chats.length} chats` : ''}</span></span></button>`).join('')
        || `<div class="empty">${PPL.list.length ? 'No one matches.' : 'No one-to-one chats yet.'}</div>`;
    }

    const whoHtml = (q) => `<a class="who" href="#people/${encodeURIComponent(q.key)}">${avatar(q.name, personColor(q.name))}<span class="r-body"><span class="r-head"><b>${esc(q.name)}</b>${appDots(q.services)}</span>
      <span class="r-text" style="display:block">${esc([...new Set(q.chats.map(srcName))].join(', '))} · ${plural(q.count, 'message')}</span></span></a>`;
    const pairHtml = (a, b) => `<div class="pair" data-a="${esc(a.key)}" data-b="${esc(b.key)}">${whoHtml(a)}<span class="vs">and</span>${whoHtml(b)}${canLabel
      ? '<span class="p-acts"><button class="small filled" data-same>Same person</button><button class="small outlined" data-apart>Not the same</button></span>' : ''}</div>`;
    const readOnly = () => (canLabel ? '' : '<p class="readonly-note">To join, split or rename people, open your backup from the extension (its Settings → Open my backup).</p>');

    function renderPerson() {
      const p = pplState.person;
      $('#personRename').hidden = $('#personJoin').hidden = !p || pplState.matches || !canLabel;
      $('#personScroll').scrollTop = 0;
      if (pplState.matches) {
        $('#personAvatar').innerHTML = '';
        $('#personName').textContent = 'The same name, more than once';
        $('#personMeta').textContent = 'Chats where the name matches but no number or handle does. Say which are the same person; you can split them again later.';
        $('#personIds').innerHTML = '';
        $('#personScroll').innerHTML = `<div class="inner">${readOnly()}${PPL.suggestions.length > 1 && canLabel ? `<div class="join-box"><button class="tonal" id="joinAll">They’re all the same people: join all ${nf(PPL.suggestions.length)}</button></div>` : ''}
          ${PPL.suggestions.map((x) => pairHtml(x.a, x.b)).join('') || '<div class="empty">Nothing left to look at.</div>'}</div>`;
        return;
      }
      if (!p) {
        $('#personAvatar').innerHTML = '';
        $('#personName').textContent = PPL.list.length ? 'Pick someone' : 'No one yet';
        $('#personMeta').textContent = '';
        $('#personIds').innerHTML = '';
        $('#personScroll').innerHTML = '';
        return;
      }
      $('#personAvatar').innerHTML = avatar(p.name, personColor(p.name));
      $('#personName').innerHTML = `${esc(p.name)}${appDots(p.services)}`;
      $('#personMeta').textContent = `${plural(p.count, 'message')} · ${plural(p.chats.length, 'chat')}${p.first ? ` · ${fmtDate(p.first)} – ${fmtDate(p.last)}` : ''}`;
      $('#personIds').innerHTML = p.ids.map((id) => `<span class="tag">${esc(idText(id))}</span>`).join(' ');
      const maybe = matchesOf(p);
      const groups = PPL.groupsOf(p);
      const perApp = new Map();
      for (const c of p.chats) perApp.set(srcName(c), (perApp.get(srcName(c)) || 0) + c.messages.length);
      const row = (c, acts) => `<div class="p-row">${avatar(c.title, convColor(c))}<span class="r-body"><span class="r-head"><b>${esc(c.title)}</b>${appBadge(c)}</span>
        <span class="r-text" style="display:block">${plural(c.messages.length, 'message')}${c.first ? ` · ${fmtDate(c.first)} – ${fmtDate(c.last)}` : ''}</span></span><span class="p-acts">${acts}</span></div>`;
      $('#personScroll').innerHTML = `<div class="inner">${readOnly()}<div id="joinBox"></div>
        ${maybe.length ? `<div class="p-sec"><h3>The same person? <span class="sub">Same name, no number or handle in common</span></h3>${maybe.map((q) => pairHtml(p, q)).join('')}</div>` : ''}
        <div class="p-sec"><h3>Chats <span class="sub">${esc([...perApp].map(([a, n]) => `${a} ${nf(n)}`).join(' · '))}</span></h3>
          ${p.chats.map((c) => row(c, `<button class="small tonal" data-open="${c.ci}">Open</button>${p.chats.length > 1 && canLabel ? `<button class="small" data-split="${esc(GMLib.chatKey(c))}" title="This chat isn’t ${esc(p.name)}: make it someone of its own">Not them</button>` : ''}`)).join('')}</div>
        ${groups.length ? `<div class="p-sec"><h3>Groups <span class="sub">${plural(groups.length, 'group chat')} they’re in</span></h3>${groups.map((c) => row(c, `<button class="small tonal" data-open="${c.ci}">Open</button>`)).join('')}</div>` : ''}
        <div class="p-sec"><h3>Messages <span class="sub">Newest first, from every chat with them</span></h3><div id="pMsgs"></div></div></div>`;
      pplState.msgs = p.chats.flatMap((c) => c.messages.filter((m) => !m.rxOf)).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      pplState.shown = 0;
      showPersonMessages();
    }
    function showPersonMessages() {
      const box = $('#pMsgs');
      const p = pplState.person;
      if (!box || !p) return;
      box.querySelector('.more')?.remove();
      const next = pplState.msgs.slice(pplState.shown, pplState.shown + 100);
      pplState.shown += next.length;
      // Their messages under the name they have here, whatever each app called them.
      const who = (m) => (m.s === 'Me' ? 'Me' : p.name);
      box.insertAdjacentHTML('beforeend', next.map((m) => `<button class="result" data-ci="${m.c.ci}" data-i="${m.i}">${avatar(who(m), personColor(who(m)))}<span class="r-body">
        <span class="r-head"><b>${esc(who(m))}</b><span>${esc(srcName(m.c))}${p.chats.filter((c) => srcKey(c) === srcKey(m.c)).length > 1 ? ` · ${esc(m.c.title)}` : ''}</span><span>· ${esc(fmtWhen(m))}</span>${m.m.length ? `<span class="tag">${m.m.length} ${m.m.length === 1 ? m.m[0].k : 'media'}</span>` : ''}</span>
        <span class="r-text" style="display:block">${esc((m.x || '').slice(0, 400))}</span></span></button>`).join('') || '<div class="empty">No messages.</div>');
      if (pplState.shown < pplState.msgs.length) box.insertAdjacentHTML('beforeend', `<button class="more tonal">Show more (${nf(pplState.msgs.length - pplState.shown)} left)</button>`);
    }

    // ---------- contacts ----------
    // Everyone (each person, as on People) as a circle with their photo or
    // initial, in a grid, with their name or number below; a circle opens the
    // person on People.
    function renderContacts() {
      const q = $('#ctFilter').value.trim().toLowerCase();
      const digits = q.replace(/\D/g, '');
      const sort = $('#ctSort').value;
      const list = PPL.list.filter((p) => !q || [p.name, ...p.names].some((n) => n.toLowerCase().includes(q))
        || p.ids.some((id) => idText(id).toLowerCase().includes(q) || (digits.length >= 3 && id.startsWith('tel:') && id.includes(digits))));
      list.sort(sort === 'count' ? (a, b) => b.count - a.count
        : sort === 'recent' ? (a, b) => (b.last || 0) - (a.last || 0)
        : sort === 'apps' ? (a, b) => b.services.length - a.services.length || b.count - a.count
        : (a, b) => isNumberName(a.name) - isNumberName(b.name) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      $('#ctCount').textContent = PPL.list.length ? (list.length === PPL.list.length ? plural(list.length, 'contact') : `${nf(list.length)} of ${plural(PPL.list.length, 'contact')}`) : '';
      $('#ctGrid').innerHTML = list.map((p) => {
        const sub = p.ids.map(idText).find((x) => x !== p.name) || (p.services.length > 1 ? `${p.services.length} apps` : plural(p.count, 'message'));
        return `<a class="contact" href="#people/${encodeURIComponent(p.key)}" title="${esc(`${p.name} · ${plural(p.count, 'message')}`)}">${avatar(p.name, personColor(p.name))}<span class="ct-name">${esc(p.name)}</span><span class="ct-sub">${esc(sub)}</span></a>`;
      }).join('') || `<div class="empty">${PPL.list.length ? 'No one matches.' : 'No one-to-one chats yet.'}</div>`;
    }
    $('#ctFilter').addEventListener('input', debounce(renderContacts, 120));
    $('#ctSort').addEventListener('change', renderContacts);

    $('#pplList').addEventListener('click', (e) => { const b = e.target.closest('.conv'); if (b) location.hash = `#people/${encodeURIComponent(b.dataset.key)}`; });
    $('#pplFilter').addEventListener('input', debounce(renderPeopleList, 120));
    $('#pplSort').addEventListener('change', renderPeopleList);
    $('#pplSuggest').addEventListener('click', () => { location.hash = '#people/~matches'; });
    $('#personBack').addEventListener('click', () => { location.hash = '#people'; });
    $('#personRename').addEventListener('click', () => {
      const p = pplState.person;
      const name = p && prompt(`A name for ${p.name} (leave it empty to go back to the name their chats give):`, p.named ? p.name : '');
      if (name != null && p) savePeople(GMLib.renamePerson(SAVED, p, name), p.key);
    });
    $('#personJoin').addEventListener('click', () => {
      const p = pplState.person;
      if (!p) return;
      const others = PPL.list.filter((q) => q !== p).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
      const label = (q) => `${q.name} · ${[...new Set(q.chats.map(srcName))].join(', ')} · ${plural(q.count, 'message')}`;
      const byLabel = new Map(others.map((q) => [label(q), q]));
      $('#joinBox').innerHTML = `<div class="join-box"><input id="joinWho" class="pill" list="joinList" placeholder="Who else is ${esc(p.name)}? A name, number or handle"><datalist id="joinList">${[...byLabel.keys()].map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
        <button class="small filled" id="joinGo">Join</button><button class="small" id="joinCancel">Cancel</button></div>`;
      $('#joinWho').focus();
      const go = () => {
        const v = $('#joinWho').value.trim();
        const named = others.filter((q) => q.name.toLowerCase() === v.toLowerCase() || q.ids.some((id) => idText(id).toLowerCase() === v.toLowerCase()));
        const q = byLabel.get(v) || (named.length === 1 ? named[0] : null);
        if (!q) { alert(named.length ? 'More than one person has that name: pick one from the list.' : 'Pick someone from the list.'); return; }
        savePeople(GMLib.joinPeople(SAVED, p, q), p.key);
      };
      $('#joinGo').onclick = go;
      $('#joinWho').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      $('#joinCancel').onclick = () => { $('#joinBox').innerHTML = ''; };
    });
    $('#personScroll').addEventListener('click', (e) => {
      const pair = e.target.closest('.pair');
      if (pair && e.target.closest('[data-same], [data-apart]')) {
        const a = personByKey(pair.dataset.a);
        const b = personByKey(pair.dataset.b);
        if (!a || !b) return;
        const stay = pplState.matches ? undefined : pplState.person?.key;
        savePeople(e.target.closest('[data-same]') ? GMLib.joinPeople(SAVED, a, b) : GMLib.keepApart(SAVED, a, b), stay);
        return;
      }
      if (e.target.closest('#joinAll')) {
        if (!confirm(`Join all ${nf(PPL.suggestions.length)} pairs of people who share a name? Each can be split again from their page.`)) return;
        savePeople(PPL.suggestions.reduce((s2, x) => GMLib.joinPeople(s2, x.a, x.b), SAVED));
        return;
      }
      const split = e.target.closest('[data-split]');
      if (split) {
        const p = pplState.person;
        const c = p?.chats.find((x) => GMLib.chatKey(x) === split.dataset.split);
        if (c) savePeople(GMLib.splitChat(SAVED, p, c), GMLib.chatKey(p.chats.find((x) => x !== c)));
        return;
      }
      const open = e.target.closest('[data-open]');
      if (open) { location.hash = `#chat/${open.dataset.open}`; return; }
      if (e.target.closest('.more')) { showPersonMessages(); return; }
      const r = e.target.closest('.result');
      if (r) location.hash = `#chat/${r.dataset.ci}/${r.dataset.i}`;
    });
    $('#convList').addEventListener('click', (e) => {
      const b = e.target.closest('.conv');
      if (b) location.hash = `#chat/${b.dataset.ci}`;
    });

    // Under a chat's name: its labels, what kind of texts it is (with "It's
    // not"), and who it's with (their page) and where else they are.
    function headerExtras(c) {
      const who = personOf(c);
      const also = elsewhere(c);
      const maybe = maybeElsewhere(c);
      const chip = (o, list, maybeOne) => `<button class="chip${maybeOne ? ' maybe' : ''}" data-goto="${o.ci}" title="${esc(o.title)}${maybeOne ? ': the same name, not joined yet' : ''}">${esc(srcName(o))}${list.filter((x) => srcKey(x) === srcKey(o)).length > 1 || srcKey(o) === srcKey(c) ? `: ${esc(o.title)}` : ''}${maybeOne ? '?' : ''}</button>`;
      const kind = c.kind ? `<div class="also">${KINDS[c.kind].icon} ${esc(KINDS[c.kind].long)}${SHOW_ALL ? '' : ': kept out of All chats, People, Search, Media and Analysis'}${canLabel ? ' <button class="chip" data-notkind title="Keep it with your other chats from now on">It’s not</button>' : ''}</div>` : '';
      return chatLabels(c).map(labelChip).join('') + kind + (who ? `<div class="also"><a class="person-link" href="#people/${encodeURIComponent(who.key)}" title="Every chat with ${esc(who.name)}, in every app">👤 ${esc(who.name)}</a>${also.length ? ` · also in ${also.map((o) => chip(o, also)).join(' ')}` : ''}${maybe.length ? ` · maybe ${maybe.map((o) => chip(o, maybe, true)).join(' ')}` : ''}</div>` : '');
    }

    // ---------- chat view ----------
    const chatScroll = $('#chatScroll');
    const chatRail = Scrubber(chatScroll, $('#chatRail'));

    function mediaHtml(md, m, k) {
      if (!md.f) return `<div class="missing">[${esc(md.k)}${D.live ? '' : `: ${esc(MEDIA_ST[mediaSt(md)].toLowerCase())}`}${md.err ? ` (${esc(md.err)})` : ''}]</div>`;
      const ref = `data-ci="${m.c.ci}" data-i="${m.i}" data-k="${k}"`;
      if (md.k === 'video') return `<video controls preload="none" src="${mediaUrl(md.f)}#t=0.1" ${ref}></video>`;
      if (md.k === 'audio') return `<audio controls preload="none" src="${mediaUrl(md.f)}"></audio>`;
      // Anything else a phone backup holds (a contact card, a document): a link to the file.
      if (md.k === 'file') return `<a class="file" href="${mediaUrl(md.f)}" download>${esc(md.f.split('/').pop())}</a>`;
      return `<img loading="lazy" src="${mediaUrl(md.f)}" alt="${esc(md.k)}" class="zoom" ${ref}>`;
    }

    // Reactions on a message, as Google Messages shows them: a small pill
    // under the bubble, each emoji once with how many, who in the tooltip.
    function reactHtml(m) {
      if (!m.rx?.length) return '';
      const by = new Map();
      for (const r of m.rx) by.set(r.e, [...(by.get(r.e) || []), r.s]);
      return `<div class="rx" data-tip="${esc(m.rx.map((r) => (r.label ? r.s : `${r.e} ${r.s}`)).join('\n'))}">${[...by].map(([e, who]) => `${esc(e)}${who.length > 1 ? `<span class="n">${who.length}</span>` : ''}`).join('')}</div>`;
    }

    // showTime: false for all but the last of a run of messages from the same
    // person in the same minute, which shows the time for them all.
    function msgHtml(m, terms, showWho, showTime = true) {
      const c = m.c;
      const who = showWho ? `${avatar(m.s, c.color.get(m.s), 'sm')}<div class="who">${esc(m.s)}</div>` : '';
      const quote = m.r ? `<div class="quote"><b>${esc(m.r.s)}</b> ${hl(m.r.x, terms)}</div>` : '';
      const media = m.m.map((md, k) => mediaHtml(md, m, k)).join('');
      const f = flagOf(m);
      const flag = `<button class="flag${f ? ' on' : ''}" data-flag="${esc(flagKey(m))}" title="${f ? 'Flagged. Click to edit the note or remove the flag' : 'Flag this message'}">${f ? '★' : '☆'}</button>` +
        `<button class="flag lab-btn${msgLabels(m).length ? ' on' : ''}" data-msglabels="${esc(flagKey(m))}" title="Labels for this message">🏷</button>`;
      const time = `<div class="time${showTime ? '' : ' more'}"${m.ts ? ` data-tip="${esc(msgDetails(m))}"` : ''}>${m.ts && showTime ? `${fmtTime(m)}${m.p ? ' ≈' : ''}` : ''}${flag}</div>`;
      const note = (f?.note ? `<div class="flag-note">★ ${esc(f.note)}</div>` : '') + (msgLabels(m).length ? `<div class="msg-labels">${msgLabels(m).map(labelChip).join('')}</div>` : '');
      const mediaOnly = !m.x && !m.r && m.m.some((md) => md.f);
      return `<div class="msg ${m.d ? 'sent' : 'recv'}${f ? ' flagged' : ''}" id="m${c.ci}-${m.i}">${who}<div class="bubble${mediaOnly ? ' media-only' : ''}">${quote}${media}${m.x ? hl(m.x, terms) : ''}</div>${reactHtml(m)}${note}${time}</div>`;
    }

    function renderPeople() {
      const c = state.conv;
      $('#people').innerHTML = `<button class="chip${state.people.size ? '' : ' on'}" data-p="">Everyone <span class="n">${nf(c.messages.length)}</span></button>` +
        c.people.map((p) => `<button class="chip${state.people.has(p.name) ? ' on' : ''}" data-p="${esc(p.name)}">${state.people.has(p.name) ? '' : avatar(p.name, c.color.get(p.name), 'xs')}${esc(p.name)} <span class="n">${nf(p.n)}</span></button>`).join('');
    }
    $('#people').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const p = b.dataset.p;
      if (!p) state.people.clear();
      else if (state.people.has(p)) state.people.delete(p);
      else state.people.add(p);
      renderChat();
    });

    // Month sections render lazily (content-visibility), so their real heights
    // arrive after we scroll and push the target away. Keep re-applying the
    // scroll whenever the content resizes, until the user scrolls themselves.
    let pin = null;
    let pinTimer;
    const chatContentObserver = new ResizeObserver(() => { if (pin) pin(); });
    function settle(fn) {
      pin = fn;
      fn();
      clearTimeout(pinTimer);
      pinTimer = setTimeout(() => { pin = null; }, 3000);
    }
    for (const el of [chatScroll, $('#chatRail')]) {
      for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) el.addEventListener(ev, () => { pin = null; }, { passive: true });
    }

    // Long chats (years of daily texts) are drawn a month at a time. Each month
    // starts as an empty section about the height it will be, is filled in when
    // it comes near the screen, and emptied again (keeping its height) when it's
    // far away, so a chat of 100,000 messages opens as quickly as a short one
    // and the page never holds more than a few months.
    let chatMonths = [];
    let chatShowNames = false;
    const monthIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const mo = chatMonths[+e.target.dataset.mi];
        if (!mo || mo.el !== e.target) continue;
        mo.near = e.isIntersecting;
        if (e.isIntersecting) fillMonth(mo);
      }
      trimMonths();
    }, { root: chatScroll, rootMargin: '1600px 0px' });
    const estimate = (msgs) => msgs.reduce((h, m) => h + 44 + Math.ceil((m.x.length || 1) / 70) * 20 + m.m.length * 220 + (m.r ? 44 : 0), 60);
    function monthHtml(mo) {
      let html = '';
      let day = null;
      let last = null;
      mo.msgs.forEach((m, k) => {
        const d = m.t ? m.t.slice(0, 10) : '';
        if (d !== day) { html += `<div class="day">${d ? fmtDay(m.ts) : 'Undated'}</div>`; day = d; last = null; }
        const next = mo.msgs[k + 1];
        const more = !!next && !!m.t && next.t === m.t && next.d === m.d && next.s === m.s;
        html += msgHtml(m, state.terms, chatShowNames && !m.d && m.s !== last, !more);
        last = m.s;
      });
      return html;
    }
    function fillMonth(mo) {
      if (!mo || mo.filled) return;
      mo.filled = true;
      mo.el.lastElementChild.innerHTML = monthHtml(mo);
      mo.el.style.height = '';
      mo.el.classList.add('in');
    }
    function trimMonths() {
      if (chatMonths.reduce((n, mo) => n + (mo.filled ? 1 : 0), 0) <= 8) return;
      for (const mo of chatMonths) {
        if (!mo.filled || mo.near) continue;
        mo.el.style.height = `${mo.el.offsetHeight}px`;
        mo.el.lastElementChild.innerHTML = '';
        mo.el.classList.remove('in');
        mo.filled = false;
      }
    }
    const monthOf = (m) => chatMonths.find((mo) => mo.k === m.month && mo.msgs.includes(m));

    function renderChat(focusI) {
      const c = state.conv;
      monthIO.disconnect();
      chatMonths = [];
      if (!c) {
        $('#chatTitle').textContent = D.conversations.length ? 'Pick a conversation' : 'No conversations';
        $('#chatAvatar').innerHTML = '';
        $('#chatMeta').textContent = '';
        $('#people').innerHTML = '';
        chatScroll.innerHTML = '';
        return;
      }
      $('#chatTitle').innerHTML = `${esc(c.title)}${appBadge(c)}`;
      $('#chatAvatar').innerHTML = avatar(c.title, convColor(c));
      // Numbers as the title shows them, and not again when the title is the number.
      const numbers = (c.contact?.people || []).map((p) => p.num && fmtNumber(p.num)).filter((n) => n && n !== fmtNumber(c.title) && !fmtNumber(c.title).split(', ').includes(n));
      $('#chatLabelsShown').innerHTML = headerExtras(c);
      $('#chatMeta').textContent = `${numbers.length ? `${numbers.slice(0, 3).join(', ')}${numbers.length > 3 ? '…' : ''} · ` : ''}${plural(c.messages.length, 'message')} · ${plural(c.people.length, 'participant')}${c.first ? ` · ${fmtDate(c.first)} – ${fmtDate(c.last)}` : ''}${c.contact?.e2ee ? ' · end-to-end encrypted' : ''}`;
      renderPeople();

      const terms = state.terms;
      const msgs = c.messages.filter((m) => !m.rxOf && (!state.people.size || state.people.has(m.s)) && (!state.mediaOnly || m.m.length));
      chatShowNames = c.multi || state.people.size > 0;
      const months = [];
      let cur = null;
      for (const m of msgs) {
        if (!cur || cur.k !== m.month) { cur = { k: m.month, msgs: [] }; months.push(cur); }
        cur.msgs.push(m);
      }
      chatScroll.innerHTML = `<div>${months.map((mo, i) => `<section class="month" data-month="${mo.k}" data-mi="${i}" style="height:${estimate(mo.msgs)}px"><h2 class="month-head">${monthLabel(mo.k)}<span class="n">${nf(mo.msgs.length)}</span></h2><div class="msgs"></div></section>`).join('') || '<div class="empty">No messages match these filters.</div>'}</div>`;
      const secs = chatScroll.firstElementChild.children;
      chatMonths = months.map((mo, i) => ({ ...mo, el: secs[i], filled: false, near: false }));
      chatContentObserver.disconnect();
      chatContentObserver.observe(chatScroll.firstElementChild);

      // Matches are whole messages (any of the words), found in the data, so
      // months that aren't drawn yet are searched too.
      state.hits = terms.length ? msgs.filter((m) => terms.some((t) => termIn(m.lx, t))) : [];
      state.hit = -1;
      $('#chatHits').textContent = terms.length ? (state.hits.length ? `${nf(state.hits.length)} found` : 'none') : '';

      const focusMsg = focusI != null ? msgs.find((m) => m.i === focusI) : null;
      const start = focusMsg ? monthOf(focusMsg) : state.hits.length ? monthOf(state.hits[state.hits.length - 1]) : chatMonths[chatMonths.length - 1];
      fillMonth(start);
      if (!focusMsg && !state.hits.length) fillMonth(chatMonths[chatMonths.length - 2]);
      const target = focusMsg && document.getElementById(`m${c.ci}-${focusMsg.i}`);
      if (target) target.classList.add('flash');
      settle(() => {
        if (target) target.scrollIntoView({ block: 'center' });
        else if (state.hits.length) goHit(state.hits.length - 1, true);
        else chatScroll.scrollTop = chatScroll.scrollHeight;
      });
      for (const mo of chatMonths) monthIO.observe(mo.el);
      chatRail.measure();
    }

    function goHit(i, quiet) {
      if (!state.hits.length) return;
      state.hit = (i + state.hits.length) % state.hits.length;
      const m = state.hits[state.hit];
      fillMonth(monthOf(m));
      chatScroll.querySelectorAll('mark.focus').forEach((x) => x.classList.remove('focus'));
      const el = document.getElementById(`m${m.c.ci}-${m.i}`);
      el?.querySelectorAll('mark').forEach((x) => x.classList.add('focus'));
      if (el) {
        if (quiet) el.scrollIntoView({ block: 'center' });
        else settle(() => el.scrollIntoView({ block: 'center' }));
      }
      $('#chatHits').textContent = `${nf(state.hit + 1)} of ${nf(state.hits.length)}`;
    }

    $('#chatSearch').addEventListener('input', debounce(() => { state.terms = parseTerms($('#chatSearch').value); renderChat(); }, 220));
    $('#chatSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goHit(state.hit + (e.shiftKey ? -1 : 1)); } });
    $('#prevHit').onclick = () => goHit(state.hit - 1);
    $('#nextHit').onclick = () => goHit(state.hit + 1);
    $('#mediaOnly').onchange = (e) => { state.mediaOnly = e.target.checked; renderChat(); };
    $('#jumpMonth').onchange = (e) => {
      const v = e.target.value;
      if (!v) return;
      const mo = chatMonths.find((x) => x.k >= v) || chatMonths[chatMonths.length - 1];
      if (!mo) return;
      fillMonth(mo);
      settle(() => { chatScroll.scrollTop = mo.el.offsetTop; });
    };
    $('#chatStats').onclick = () => { if (state.conv) location.hash = `#stats/${state.conv.ci}`; };

    // The labels menu, for a chat or a message: tick labels, add new ones,
    // or rename and remove them.
    function labelMenu(anchor, target) {
      document.querySelector('.lab-menu')?.remove();
      const menu = document.createElement('div');
      menu.className = 'lab-menu';
      const ids = () => target.chat ? chatLabels(target.chat) : msgLabels(target.msg);
      const draw = (manage = false) => {
        menu.innerHTML = manage
          ? `<div class="lab-title">Rename or remove labels</div>${LABELS.labels.map((l) => `<div class="lab-row"><span>${esc(l.icon)} ${esc(l.name)}</span><span><button data-ren="${esc(l.id)}" title="Rename">✎</button><button data-del="${esc(l.id)}" title="Remove this label everywhere">🗑</button></span></div>`).join('')}<div class="lab-foot"><button data-back>Done</button></div>`
          : `<div class="lab-title">${target.chat ? `Labels for “${esc(target.chat.title)}”` : 'Labels for this message'}</div>
            ${LABELS.labels.map((l) => `<label class="lab-row"><span><input type="checkbox" data-l="${esc(l.id)}"${ids().includes(l.id) ? ' checked' : ''}${canLabel ? '' : ' disabled'}> ${esc(l.icon)} ${esc(l.name)}</span></label>`).join('')}
            ${canLabel ? '<div class="lab-foot"><button data-new>New label…</button><button data-manage>Rename or remove…</button></div>'
              : '<div class="lab-note">To add or change labels, open your backup from the extension: click 💬, then “Open my backup”.</div>'}`;
      };
      draw();
      document.body.append(menu);
      const r = anchor.getBoundingClientRect();
      menu.style.top = `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
      menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
      const refresh = () => {
        renderConvList();
        if (state.conv) $('#chatLabelsShown').innerHTML = headerExtras(state.conv);
        if (target.msg) { const el = document.getElementById(`m${target.msg.c.ci}-${target.msg.i}`); if (el) el.outerHTML = msgHtml(target.msg, state.terms, !!el.querySelector('.who'), !el.querySelector('.time.more')); }
        fillLabelSelect();
        if (location.hash.startsWith('#review')) renderReview();
      };
      menu.addEventListener('change', async (e) => {
        const id = e.target.dataset.l;
        if (!id) return;
        if (target.chat) toggleIn(LABELS.chats, chatKey(target.chat), id); else toggleIn(LABELS.messages, msgLabelKey(target.msg), id);
        refresh();
        await saveLabels();
      });
      menu.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.new !== undefined) {
          const name = (prompt('Name for the new label (start it with an emoji to use that as its icon):') || '').trim();
          if (!name) return;
          const emoji = name.match(/^\p{Extended_Pictographic}\uFE0F?/u)?.[0];
          const label = { id: `l${Date.now().toString(36)}`, name: emoji ? name.slice(emoji.length).trim() || name : name, icon: emoji || '🏷' };
          LABELS.labels.push(label);
          if (target.chat) toggleIn(LABELS.chats, chatKey(target.chat), label.id); else toggleIn(LABELS.messages, msgLabelKey(target.msg), label.id);
          draw(); refresh(); await saveLabels();
        } else if (b.dataset.manage !== undefined) { draw(true); }
        else if (b.dataset.back !== undefined) { draw(); }
        else if (b.dataset.ren) {
          const l = labelById(b.dataset.ren);
          const name = (prompt(`New name for “${l.name}”:`, l.name) || '').trim();
          if (!name) return;
          l.name = name;
          draw(true); refresh(); await saveLabels();
        } else if (b.dataset.del) {
          const l = labelById(b.dataset.del);
          if (!confirm(`Remove the label “${l.name}” from every chat and message? The chats and messages themselves aren’t affected.`)) return;
          LABELS.labels = LABELS.labels.filter((x) => x !== l);
          for (const k of ['chats', 'messages']) for (const key of Object.keys(LABELS[k])) LABELS[k][key] = LABELS[k][key].filter((x) => x !== l.id);
          if (state.folder === l.id) state.folder = '';
          draw(true); refresh(); await saveLabels();
        }
      });
      setTimeout(() => document.addEventListener('click', function close(e) {
        if (menu.contains(e.target)) return;
        menu.remove();
        document.removeEventListener('click', close, true);
      }, true));
    }
    $('#chatLabels').onclick = (e) => { if (state.conv) labelMenu(e.currentTarget, { chat: state.conv }); };
    // Opened with "Open my backup": a chat can be deleted from the backup.
    // Settings does it (it keeps the index, checksums and log right), after asking.
    $('#chatDelete').hidden = !LIBRARY || !window.chrome?.runtime?.id;
    $('#chatDelete').onclick = () => {
      if (state.conv) toSettings(`delete:${encodeURIComponent(state.conv.folder)}`);
    };
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-msglabels]');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      const m = BY_KEY.get(b.dataset.msglabels);
      if (m) labelMenu(b, { msg: m });
    }, true);

    // Flag / unflag, with a note. The message re-renders in place.
    function toggleFlag(key) {
      const m = BY_KEY.get(key);
      if (!m) return;
      const cur = FLAGS[key];
      const note = prompt(cur ? 'Edit the note for this flagged message, or clear it and press OK to remove the flag:' : 'Flag this message. Add a note (optional):', cur?.note || '');
      if (note === null) return;
      if (cur && note.trim() === '') delete FLAGS[key];
      else FLAGS[key] = { note: note.trim(), at: new Date().toISOString() };
      saveFlags();
      const el = document.getElementById(`m${m.c.ci}-${m.i}`);
      if (el) el.outerHTML = msgHtml(m, state.terms, !!el.querySelector('.who'), !el.querySelector('.time.more'));
      document.querySelectorAll(`.result[data-key="${CSS.escape(key)}"] .r-flag`).forEach((x) => { x.textContent = FLAGS[key] ? `★ ${FLAGS[key].note || 'flagged'}` : ''; });
      updateFlagCount();
      if (location.hash.startsWith('#review')) renderReview();
    }
    function updateFlagCount() {
      const n = Object.keys(FLAGS).filter((k) => BY_KEY.has(k)).length;
      $('#flagCount').textContent = n ? `★ ${nf(n)} flagged` : '';
    }
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-flag]');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      toggleFlag(b.dataset.flag);
    }, true);
    $('#flagCount').onclick = () => { $('#rShow').value = 'flagged'; if (location.hash === '#review') renderReview(); else location.hash = '#review'; };
    chatScroll.addEventListener('click', (e) => {
      const img = e.target.closest('img.zoom');
      if (!img) return;
      const list = MEDIA.filter((x) => x.m.c === state.conv && x.md.k !== 'audio');
      openLightbox(list, list.findIndex((x) => x.m.i === +img.dataset.i && x.k === +img.dataset.k));
    });

    function openChat(ci, focusI) {
      const c = D.conversations[ci];
      if (!c) return;
      if (c !== state.conv) {
        state.conv = c;
        state.people.clear();
        state.mediaOnly = false;
        $('#mediaOnly').checked = false;
        state.terms = [];
        $('#chatSearch').value = '';
        $('#jumpMonth').value = '';
        renderConvList();
        renderChat(focusI);
      } else if (focusI != null) {
        // Clear filters that might hide the target message.
        state.people.clear();
        state.mediaOnly = false;
        $('#mediaOnly').checked = false;
        renderChat(focusI);
      }
      document.querySelector(`.conv[data-ci="${ci}"]`)?.scrollIntoView({ block: 'nearest' });
    }

    // ---------- global search ----------
    // Each chat by name, with its app when it isn't a text chat (two chats with Alex can be texts and WhatsApp).
    const fillConvSelect = (sel) => { sel.innerHTML += D.conversations.filter((c) => !tucked(c)).sort(chatOrder).map((c) => `<option value="${c.ci}">${favourite(c) ? '⭐ ' : ''}${esc(c.title)}${isMainSms(c) && !MULTI_SMS ? '' : ` (${esc(srcName(c))})`}</option>`).join(''); };
    const fillPeople = (sel, convIdx, anyLabel = 'Anyone') => {
      const keep = sel.value;
      const list = convIdx === '' || convIdx === 'all' ? PEOPLE : D.conversations[convIdx].people.map((p) => p.name).sort(personOrder);
      sel.innerHTML = `<option value="">${anyLabel}</option>` + list.map((p) => `<option${p === keep ? ' selected' : ''}>${esc(p)}</option>`).join('');
    };
    ['#sConv', '#mConv', '#rConv'].forEach((s) => fillConvSelect($(s)));
    fillPeople($('#sSender'), '');
    fillPeople($('#mSender'), '');
    $('#sWeekday').innerHTML += WEEKDAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('');
    $('#sHour').innerHTML += Array.from({ length: 24 }, (_, h) => `<option value="${h}">${hourLabel(h)}–${hourLabel((h + 1) % 24)}</option>`).join('');

    let searchResults = [];
    let shown = 0;
    function runSearch() {
      const terms = parseTerms($('#q').value);
      const conv = $('#sConv').value;
      const sender = $('#sSender').value;
      const kind = $('#sKind').value;
      const label = $('#sLabel').value;
      const wd = $('#sWeekday').value;
      const hr = $('#sHour').value;
      const from = $('#sFrom').value ? parseTs($('#sFrom').value) : null;
      const to = $('#sTo').value ? parseTs($('#sTo').value) + DAY : null;
      const active = terms.length || conv || sender || kind || label || wd || hr || from || to;
      const box = $('#results');
      if (!active) {
        searchResults = [];
        box.innerHTML = `<div class="help"><p><b>Search every conversation at once.</b> Type words to find messages containing all of them, or put a word or phrase in quotes for an exact match of whole words ("now" won’t find “know”). Quoted replies are searched too.</p>
          <p>Narrow it down with the filters: one conversation, one person, a label, sent or received, media, replies or links, a day of the week, an hour of the day, or a date range. You can leave the search box empty and use only filters.</p>
          <p>Charts on the Analysis tab are clickable and open the matching messages here. Click a result to see it in the chat. <b>Export CSV</b> saves the current results.</p></div>`;
        return;
      }
      const pool = conv === '' ? ALL : D.conversations[conv].messages;
      searchResults = pool.filter((m) => {
        if (sender && m.s !== sender) return false;
        if (label && !msgLabels(m).includes(label) && !chatLabels(m.c).includes(label)) return false;
        if (kind && !(kind === 'sent' ? m.d : kind === 'received' ? !m.d : kind === 'media' ? m.m.length : kind === 'reply' ? !!m.r : kind === 'flagged' ? !!flagOf(m) : /https?:\/\/|www\./i.test(m.x))) return false;
        if (from != null && (m.ts == null || m.ts < from)) return false;
        if (to != null && (m.ts == null || m.ts >= to)) return false;
        if ((wd !== '' || hr !== '') && m.ts == null) return false;
        if (wd !== '' && new Date(m.ts).getDay() !== +wd) return false;
        if (hr !== '' && (m.t.length <= 10 || new Date(m.ts).getHours() !== +hr)) return false;
        return hasTerms(m, terms);
      });
      const asc = $('#sSort').value === 'old';
      searchResults.sort((a, b) => ((a.ts ?? 0) - (b.ts ?? 0)) * (asc ? 1 : -1));
      const convs = new Set(searchResults.map((m) => m.c)).size;
      box.innerHTML = `<div class="summary">${plural(searchResults.length, 'message')} in ${plural(convs, 'conversation')}</div>` +
        (searchResults.length > 1 ? `<div class="panel trend"><h3>Over time</h3><div class="sub">Matches per month. Click a bar to narrow to that month.</div>${barChart(bucketBy(searchResults, 'month'), { height: 110, drill: 'search' })}</div>` : '') +
        '<div id="rList"></div>';
      shown = 0;
      showMore(terms);
    }
    function showMore(terms = parseTerms($('#q').value)) {
      const list = $('#rList');
      if (!list) return;
      list.querySelector('.more')?.remove();
      const next = searchResults.slice(shown, shown + 200);
      shown += next.length;
      // Optional context: the messages just before and after each result.
      const around = (m, from, to) => m.c.messages.slice(Math.max(0, m.pos + from), Math.max(0, m.pos + to))
        .map((x) => `<span class="ctx-line"><b>${esc(x.s === 'Me' ? 'You' : x.s)}</b> ${esc((x.x || (x.m.length ? `[${x.m[0].k}]` : '')).slice(0, 160))}</span>`).join('');
      const ctx = $('#sCtx').checked;
      list.insertAdjacentHTML('beforeend', next.map((m) => `<button class="result" data-ci="${m.c.ci}" data-i="${m.i}" data-key="${esc(flagKey(m))}">${avatar(m.s, m.c.color.get(m.s))}<span class="r-body">
        <span class="r-head"><b>${esc(m.s)}</b><span>in ${esc(m.c.title)}${isMainSms(m.c) && !MULTI_SMS ? '' : ` · ${esc(srcName(m.c))}`}</span><span>· ${esc(fmtWhen(m))}</span>${m.m.length ? `<span class="tag">${m.m.length} ${m.m.length === 1 ? m.m[0].k : 'media'}</span>` : ''}${m.r ? '<span class="tag">reply</span>' : ''}<span class="r-flag">${flagOf(m) ? `★ ${esc(flagOf(m).note || 'flagged')}` : ''}</span></span>
        ${ctx ? `<span class="ctx">${around(m, -2, 0)}</span>` : ''}<span class="r-text" style="display:block">${snippet(m, terms)}</span>${ctx ? `<span class="ctx">${around(m, 1, 3)}</span>` : ''}</span>
        <span class="flag${flagOf(m) ? ' on' : ''}" data-flag="${esc(flagKey(m))}" title="Flag this message" role="button">${flagOf(m) ? '★' : '☆'}</span></button>`).join(''));
      if (shown < searchResults.length) list.insertAdjacentHTML('beforeend', `<button class="more tonal">Show more (${nf(searchResults.length - shown)} left)</button>`);
    }
    $('#results').addEventListener('click', (e) => {
      if (e.target.closest('.more')) return showMore();
      const r = e.target.closest('.result');
      if (r) location.hash = `#chat/${r.dataset.ci}/${r.dataset.i}`;
    });
    $('#q').addEventListener('input', debounce(runSearch, 220));
    // Search by label: on the message itself or on its chat.
    function fillLabelSelect() {
      const opts = LABELS.labels.map((l) => `<option value="${esc(l.id)}">${esc(l.icon)} ${esc(l.name)}</option>`).join('');
      let cur = $('#sLabel').value;
      $('#sLabel').innerHTML = '<option value="">Any label</option>' + opts;
      $('#sLabel').value = cur;
      cur = $('#rShow').value;
      $('#rShow').innerHTML = '<option value="">Everything flagged or labelled</option><option value="flagged">★ Flagged</option>' + opts;
      $('#rShow').value = [...$('#rShow').options].some((o) => o.value === cur) ? cur : '';
    }
    fillLabelSelect();
    ['#sLabel', '#sSender', '#sKind', '#sWeekday', '#sHour', '#sFrom', '#sTo', '#sSort', '#sCtx'].forEach((s) => $(s).addEventListener('change', runSearch));
    $('#sConv').addEventListener('change', () => { fillPeople($('#sSender'), $('#sConv').value); runSearch(); });
    function resetSearch() {
      ['#q', '#sFrom', '#sTo'].forEach((s) => { $(s).value = ''; });
      ['#sConv', '#sKind', '#sLabel', '#sWeekday', '#sHour'].forEach((s) => { $(s).value = ''; });
      $('#sSort').value = 'new';
      fillPeople($('#sSender'), '');
      $('#sSender').value = '';
    }
    $('#sReset').onclick = () => { resetSearch(); runSearch(); };
    $('#sCsv').onclick = () => {
      if (!searchResults.length) return;
      const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const rows = [['conversation', 'message_id', 'timestamp', 'timestamp_raw', 'sender', 'direction', 'text', 'reply_to', 'media', 'media_sha256', 'flagged', 'flag_note', 'labels']]
        .concat(searchResults.map((m) => [m.c.title, m.id, m.t, m.tr, m.s, m.d ? 'sent' : 'received', m.x, m.r ? `${m.r.s}: ${m.r.x}` : '',
          m.m.map((x) => x.f || `[${x.k} missing]`).join(' '), m.m.map((x) => x.sha || '').filter(Boolean).join(' '), flagOf(m) ? 'yes' : '', flagOf(m)?.note || '', [...new Set([...chatLabels(m.c), ...msgLabels(m)])].map((id) => labelById(id).name).join('; ')]));
      const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'search-results.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };

    // ---------- review ----------
    // Everything you've marked in one place: flagged messages with their notes,
    // then each label with its chats and messages. Flags, notes and labels can
    // be changed here, long after the backup.
    const expanded = new Set();
    let reviewShown = [];
    function reviewGroups() {
      const show = $('#rShow').value;
      const conv = $('#rConv').value;
      const terms = parseTerms($('#rFind').value);
      const asc = $('#rSort').value !== 'new';
      const byTime = (a, b) => ((a.ts ?? 0) - (b.ts ?? 0)) * (asc ? 1 : -1);
      const keep = (m) => (conv === '' || m.c.ci === +conv) && (!terms.length || terms.every((t) => termIn(m.lx, t) || termIn((flagOf(m)?.note || '').toLowerCase(), t)));
      const labelled = ALL.filter((m) => LABELS.messages[msgLabelKey(m)]?.length && keep(m));
      const groups = [];
      if (!show || show === 'flagged') groups.push({ id: 'flagged', icon: '★', name: 'Flagged', chats: [], msgs: ALL.filter((m) => flagOf(m) && keep(m)).sort(byTime) });
      for (const l of LABELS.labels) {
        if (show && show !== l.id) continue;
        const chats = D.conversations.filter((c) => chatLabels(c).includes(l.id) && (conv === '' || c.ci === +conv) && (!terms.length || terms.every((t) => termIn(c.title.toLowerCase(), t))));
        const msgs = labelled.filter((m) => msgLabels(m).includes(l.id)).sort(byTime);
        if (chats.length || msgs.length || show === l.id) groups.push({ id: l.id, icon: l.icon, name: l.name, chats, msgs });
      }
      return groups;
    }
    function reviewMsg(m) {
      const f = flagOf(m);
      const key = esc(flagKey(m));
      const chatLabs = chatLabels(m.c);
      return `<div class="result rv-item" data-ci="${m.c.ci}" data-i="${m.i}" data-key="${key}">${avatar(m.s, m.c.color.get(m.s))}<span class="r-body">
        <span class="r-head"><b>${esc(m.s)}</b><span>in ${esc(m.c.title)}${isMainSms(m.c) && !MULTI_SMS ? '' : ` · ${esc(srcName(m.c))}`}</span><span>· ${esc(fmtWhen(m))}</span>${m.m.length ? `<span class="tag">${m.m.length} ${m.m.length === 1 ? m.m[0].k : 'media'}</span>` : ''}${m.r ? '<span class="tag">reply</span>' : ''}</span>
        <span class="r-text" style="display:block">${snippet(m, parseTerms($('#rFind').value))}</span>
        ${f ? `<span class="rv-note">★ ${esc(f.note || 'Flagged, no note')}</span>` : ''}
        <span class="rv-labels">${msgLabels(m).map(labelChip).join('')}${chatLabs.length ? `<span class="rv-chatlabs" title="Labels on the whole chat">chat: ${chatLabs.map((id) => esc(labelById(id).icon)).join(' ')}</span>` : ''}</span></span>
        <span class="rv-actions"><button class="small" data-flag="${key}" title="${f ? 'Edit the note, or clear it to remove the flag' : 'Flag this message'}">${f ? '★ Note…' : '☆ Flag'}</button>
        <button class="small" data-msglabels="${key}" title="Labels for this message">🏷 Labels</button></span></div>`;
    }
    function renderReview() {
      const groups = reviewGroups();
      const nothing = !Object.keys(FLAGS).some((k) => BY_KEY.has(k)) && !Object.values(LABELS.chats).some((a) => a.length) && !Object.values(LABELS.messages).some((a) => a.length);
      reviewShown = [...new Set(groups.flatMap((g) => g.msgs))].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
      if (nothing) {
        $('#reviewBody').innerHTML = `<div class="help"><p><b>Nothing flagged or labelled yet.</b> Everything you mark shows up here, grouped by label, so you can review it in one place.</p>
          <p>In a chat, point at a message and click <b>☆</b> to flag it with a note, or <b>🏷</b> to give it a label. Use <b>🏷 Labels</b> at the top of a chat to label the whole chat (Favorites, Family, Spam…).</p>
          <p>${canLabel ? 'Flags, notes and labels are saved in your backup folder, so they stay with the backup.' : 'To keep labels with your backup, open it from the extension: click 💬, then “Open my backup”.'}</p></div>`;
        return;
      }
      const chatRow = (c) => `<div class="result rv-chat" data-ci="${c.ci}">${avatar(c.title, c.color.get(c.people.find((p) => p.name !== 'Me')?.name) || 'var(--c2)')}<span class="r-body">
        <span class="r-head"><b>${esc(c.title)}</b><span>${plural(c.messages.length, 'message')}${c.last ? ` · last ${esc(fmtDate(c.last))}` : ''}</span></span>
        <span class="rv-labels">${chatLabels(c).map(labelChip).join('')}</span></span>
        <span class="rv-actions"><button class="small" data-chatlabels="${c.ci}" title="Labels for this chat">🏷 Labels</button></span></div>`;
      $('#reviewBody').innerHTML = `<div class="summary">${plural(reviewShown.length, 'message')}${groups.some((g) => g.chats.length) ? ` and ${plural(new Set(groups.flatMap((g) => g.chats)).size, 'chat')}` : ''}</div>` + groups.map((g) => {
        const all = expanded.has(g.id);
        const msgs = all ? g.msgs : g.msgs.slice(0, 100);
        return `<section class="rv-group"><h2 class="rv-head">${esc(g.icon)} ${esc(g.name)}<span class="n">${[g.chats.length && plural(g.chats.length, 'chat'), (g.msgs.length || !g.chats.length) && plural(g.msgs.length, 'message')].filter(Boolean).join(' · ')}</span></h2>
          ${g.chats.map(chatRow).join('')}${msgs.map(reviewMsg).join('')}
          ${!g.chats.length && !g.msgs.length ? '<div class="gray rv-empty">Nothing here with these filters.</div>' : ''}
          ${msgs.length < g.msgs.length ? `<button class="more tonal" data-expand="${esc(g.id)}">Show all ${nf(g.msgs.length)}</button>` : ''}</section>`;
      }).join('');
    }
    $('#reviewBody').addEventListener('click', (e) => {
      const more = e.target.closest('[data-expand]');
      if (more) { expanded.add(more.dataset.expand); renderReview(); return; }
      const cl = e.target.closest('[data-chatlabels]');
      if (cl) { labelMenu(cl, { chat: D.conversations[+cl.dataset.chatlabels] }); return; }
      if (e.target.closest('button')) return;
      const r = e.target.closest('.result');
      if (r) location.hash = r.dataset.i != null ? `#chat/${r.dataset.ci}/${r.dataset.i}` : `#chat/${r.dataset.ci}`;
    });
    ['#rShow', '#rConv', '#rSort'].forEach((s) => $(s).addEventListener('change', renderReview));
    $('#rFind').addEventListener('input', debounce(renderReview, 220));
    $('#rPrint').onclick = () => {
      if (!reviewShown.length) return;
      const show = $('#rShow').value;
      const what = show === 'flagged' ? 'Flagged messages' : show ? `Messages labelled ${labelById(show)?.name || ''}` : 'Flagged and labelled messages';
      printReport('Review', { description: `${what}${$('#rConv').value !== '' ? ` in ${D.conversations[$('#rConv').value].title}` : ''}`, multi: true }, reviewShown);
    };
    $('#rCsv').onclick = () => {
      const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const names = (ids) => ids.map((id) => labelById(id).name).join('; ');
      const rows = [['group', 'type', 'conversation', 'message_id', 'timestamp', 'sender', 'direction', 'text', 'flagged', 'flag_note', 'message_labels', 'chat_labels']];
      for (const g of reviewGroups()) {
        for (const c of g.chats) rows.push([g.name, 'chat', c.title, '', '', '', '', '', '', '', '', names(chatLabels(c))]);
        for (const m of g.msgs) rows.push([g.name, 'message', m.c.title, m.id, m.t, m.s, m.d ? 'sent' : 'received', m.x, flagOf(m) ? 'yes' : '', flagOf(m)?.note || '', names(msgLabels(m)), names(chatLabels(m.c))]);
      }
      if (rows.length < 2) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
      a.download = 'review.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };

    // ---------- print / save as PDF ----------
    // Builds a plain, paginated report of the given messages and opens the
    // browser's print dialog (choose "Save as PDF" there).
    function printReport(title, scope, msgs) {
      const info = D.info || {};
      const rows = msgs.map((m) => {
        const f = flagOf(m);
        const media = m.m.map((md) => (md.f && (md.k === 'image' || md.k === 'gif' || md.k === 'preview')
          ? `<img src="${mediaUrl(md.f)}" alt="">` : `<span class="pm">[${esc(md.k)}${md.f ? `: ${esc(md.f.split('/').pop())}` : ''}]</span>`)).join('');
        return `<tr class="${f ? 'pf' : ''}"><td class="pt">${esc(m.ts ? fmtWhen(m) : 'Undated')}${m.p ? ' ≈' : ''}</td><td class="ps">${esc(m.s === 'Me' ? 'You' : m.s)}${m.c && D.conversations.length > 1 && scope.multi ? `<div class="pc">${esc(m.c.title)}</div>` : ''}</td>
          <td>${m.r ? `<div class="pq">↩ ${esc(m.r.s)}: ${esc(m.r.x)}</div>` : ''}${esc(m.x)}${media ? `<div class="pmedia">${media}</div>` : ''}${f ? `<div class="pn">★ Flagged${f.note ? `: ${esc(f.note)}` : ''}</div>` : ''}</td></tr>`;
      }).join('');
      const dated = msgs.filter((m) => m.ts);
      $('#printArea').innerHTML = `<h1>${esc(title)}</h1>
        <div class="pmeta">${esc(scope.description)}<br>${plural(msgs.length, 'message')}${dated.length ? `, ${esc(fmtDate(dated[0].ts))} – ${esc(fmtDate(dated[dated.length - 1].ts))}` : ''}${scope.numbers ? ` · ${esc(scope.numbers)}` : ''}<br>
        Source: ${D.live ? 'live analysis of Google Messages for Web' : `archive created ${esc(D.exported_at ? new Date(D.exported_at).toLocaleString() : '?')}${D.updated_at ? `, updated ${esc(new Date(D.updated_at).toLocaleString())}` : ''}`}
        · ${esc(`${info.tool || 'Message Archivist'} ${info.version || ''}`)}${info.case_note ? ` · Case: ${esc(info.case_note)}` : ''} · Printed ${esc(new Date().toLocaleString())} (${esc(info.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)})</div>
        <table class="ptable"><thead><tr><th>When</th><th>From</th><th>Message</th></tr></thead><tbody>${rows}</tbody></table>`;
      // Let photos load before the dialog opens.
      const imgs = [...$('#printArea').querySelectorAll('img')];
      Promise.race([Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))), new Promise((r) => setTimeout(r, 4000))])
        .then(() => window.print());
    }
    $('#chatPrint').onclick = () => {
      const c = state.conv;
      if (!c) return;
      const msgs = c.messages.filter((m) => (!state.people.size || state.people.has(m.s)) && (!state.mediaOnly || m.m.length));
      const filters = [state.people.size ? `only ${[...state.people].join(', ')}` : '', state.mediaOnly ? 'media only' : ''].filter(Boolean).join(', ');
      printReport(c.title, { description: `Conversation${filters ? ` (${filters})` : ''} · participants: ${c.people.map((p) => (p.name === 'Me' ? 'You' : p.name)).join(', ')}`,
        numbers: (c.contact?.people || []).map((p) => `${p.n}: ${p.num || '?'}`).join(', ') }, msgs);
    };
    $('#sPrint').onclick = () => {
      if (!searchResults.length) return;
      const parts = [$('#q').value && `matching ${$('#q').value}`, $('#sConv').value !== '' && `in ${D.conversations[$('#sConv').value].title}`, $('#sSender').value && `from ${$('#sSender').value}`,
        $('#sKind').value && $('#sKind').selectedOptions[0].text.toLowerCase(), $('#sWeekday').value !== '' && `on ${$('#sWeekday').selectedOptions[0].text}`,
        $('#sHour').value !== '' && `at ${$('#sHour').selectedOptions[0].text}`, ($('#sFrom').value || $('#sTo').value) && `${$('#sFrom').value || '…'} to ${$('#sTo').value || '…'}`].filter(Boolean);
      printReport('Search results', { description: `Messages ${parts.join(', ') || '(all)'}`, multi: true }, searchResults);
    };

    // Opens Search with filters set: used by every clickable chart.
    function drill(f) {
      resetSearch();
      if (f.conv != null && f.conv !== 'all') { $('#sConv').value = String(f.conv); fillPeople($('#sSender'), String(f.conv)); }
      if (f.person) $('#sSender').value = f.person;
      if (f.from) $('#sFrom').value = f.from;
      if (f.to) $('#sTo').value = f.to;
      if (f.weekday != null) $('#sWeekday').value = String(f.weekday);
      if (f.hour != null) $('#sHour').value = String(f.hour);
      if (f.kind) $('#sKind').value = f.kind;
      if (f.q) $('#q').value = `"${f.q}"`; // whole words: "now" shouldn't find "know"
      $('#sSort').value = f.sort || 'old';
      if (location.hash === '#search') runSearch(); else location.hash = '#search';
    }

    // ---------- media gallery ----------
    const mediaScroll = $('#mediaScroll');
    const mediaRail = Scrubber(mediaScroll, $('#mediaRail'));
    let mediaList = [];
    const videoObserver = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.preload = 'metadata'; videoObserver.unobserve(e.target); }
    }, { root: mediaScroll, rootMargin: '400px' });

    function renderMedia() {
      const conv = $('#mConv').value;
      const sender = $('#mSender').value;
      const kind = $('#mKind').value;
      const status = $('#mStatus').value;
      const pool = MEDIA_ALL.filter((x) => (conv === '' || x.m.c.ci === +conv) && (!sender || x.m.s === sender) && (!kind || x.md.k === kind));
      // Each status shows how many there are with the other filters.
      const n = {};
      for (const x of pool) { const k = x.st === 'same' ? 'full' : x.st; n[k] = (n[k] || 0) + 1; }
      n.saved = pool.filter((x) => x.md.f).length;
      n.all = pool.length;
      for (const o of $('#mStatus').options) o.textContent = `${o.dataset.label || (o.dataset.label = o.textContent)} (${nf(n[o.value || 'saved'] || 0)})`;
      mediaList = pool.filter((x) => (status === 'all' ? true : !status ? x.md.f : (x.st === 'same' ? 'full' : x.st) === status))
        .sort((a, b) => (b.m.ts ?? -Infinity) - (a.m.ts ?? -Infinity));
      $('#mCount').textContent = plural(mediaList.length, 'item');
      const ICON = { waiting: '⏳', failed: '⚠', skipped: '⊘', left: '⧉' };
      const perMonth = new Map();
      for (const x of mediaList) perMonth.set(x.m.month, (perMonth.get(x.m.month) || 0) + 1);
      let html = '';
      let month = null;
      mediaList.forEach((x, idx) => {
        if (x.m.month !== month) {
          if (month !== null) html += '</div></section>';
          html += `<section class="month" data-month="${x.m.month}"><h2 class="month-head">${monthLabel(x.m.month)}<span class="n">${nf(perMonth.get(x.m.month))}</span></h2><div class="grid">`;
          month = x.m.month;
        }
        const tipText = `${x.m.s} · ${fmtWhen(x.m)}\n${x.m.c.title}\n${MEDIA_ST[x.st]}${x.md.w ? `, ${x.md.w}×${x.md.h}` : ''}${x.md.err ? `\n${x.md.err}` : x.md.why ? `\n${LEFT_WHY[x.md.why] || x.md.why}` : ''}`;
        const src = x.md.f && mediaUrl(x.md.f);
        const stBadge = x.st === 'thumbnail' ? '<span class="st-badge">thumbnail</span>' : '';
        html += !x.md.f
          ? `<button class="tile missing" data-idx="${idx}" data-tip="${esc(tipText)}\nClick to see it in the chat."><span class="miss-ico">${ICON[x.st] || '?'}</span><span class="miss-txt">${esc(MEDIA_ST[x.st])}</span><span class="badge">${esc(x.md.k || 'media')}</span></button>`
          : x.md.k === 'audio'
          ? `<button class="tile audio" data-idx="${idx}" data-tip="${esc(tipText)}">♪<span class="badge">audio</span></button>`
          : x.md.k === 'file'
          ? `<button class="tile audio" data-idx="${idx}" data-tip="${esc(tipText)}">📎<span class="badge">file</span></button>`
          : x.md.k === 'video'
            ? `<button class="tile" data-idx="${idx}" data-tip="${esc(tipText)}"><video muted preload="none" src="${src}#t=0.1"></video><span class="badge">▶ video</span></button>`
            : `<button class="tile" data-idx="${idx}" data-tip="${esc(tipText)}"><img loading="lazy" src="${src}" alt="">${x.md.k === 'gif' ? '<span class="badge">GIF</span>' : ''}${stBadge}</button>`;
      });
      if (month !== null) html += '</div></section>';
      mediaScroll.innerHTML = html || `<div class="empty">${D.live ? 'The live analyzer reads text only; export the chat to see its photos and videos here.' : status === 'waiting' || status === 'thumbnail' ? `None. ${status === 'waiting' ? 'Every photo listed has been fetched.' : 'Every saved photo is full size.'}` : 'No media matches these filters.'}</div>`;
      if (html && (status === 'waiting' || status === 'thumbnail' || status === 'failed') && !D.live) {
        mediaScroll.insertAdjacentHTML('afterbegin', `<div class="media-hint">${status === 'thumbnail'
          ? 'These were saved at the size shown in the chat. To replace them with full-size copies, open the chat in Google Messages, click the 💬 extension icon and choose “Upgrade to full size”. Settings → Check for problems does it for every chat at once.'
          : 'To fetch these, open the chat in Google Messages, click the 💬 extension icon and choose “Fetch photos”. It goes back in the chat only as far as it needs to. Settings → Check for problems does it for every chat at once.'}</div>`);
      }
      mediaScroll.querySelectorAll('video').forEach((v) => videoObserver.observe(v));
      mediaScroll.scrollTop = 0;
      requestAnimationFrame(() => mediaRail.measure());
    }
    mediaScroll.addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      const x = mediaList[+t.dataset.idx];
      if (!x.md.f) { location.hash = `#chat/${x.m.c.ci}/${x.m.i}`; return; }
      const files = mediaList.filter((y) => y.md.f);
      openLightbox(files, files.indexOf(x));
    });
    $('#mConv').addEventListener('change', () => { fillPeople($('#mSender'), $('#mConv').value); renderMedia(); });
    ['#mSender', '#mKind', '#mStatus'].forEach((s) => $(s).addEventListener('change', renderMedia));

    // ---------- lightbox ----------
    let lb = { list: [], i: 0 };
    function openLightbox(list, i) {
      if (i < 0 || !list.length) return;
      lb = { list, i };
      $('#lightbox').classList.add('open');
      showLightbox();
    }
    function showLightbox() {
      const x = lb.list[lb.i];
      const src = mediaUrl(x.md.f);
      $('#lbStage').innerHTML = x.md.k === 'video' ? `<video controls autoplay src="${src}"></video>`
        : x.md.k === 'audio' ? `<audio controls autoplay src="${src}"></audio>`
        : x.md.k === 'file' ? `<a class="file" href="${src}" download>${esc(x.md.f.split('/').pop())}</a>`
        : `<img src="${src}" alt="">`;
      $('#lbCap').innerHTML = `<b>${esc(x.m.s)}</b> · ${esc(fmtWhen(x.m))} · ${esc(x.m.c.title)} <span style="opacity:.6">(${lb.i + 1} of ${lb.list.length})</span>` +
        `<span style="opacity:.6"> · ${esc(MEDIA_ST[mediaSt(x.md)])}${x.md.w ? ` · ${x.md.w}×${x.md.h}` : ''}${x.md.src ? ` · ${esc(x.md.src)}` : ''}</span>` +
        `${x.md.sha ? `<div class="sha">SHA-256 ${x.md.sha}</div>` : ''}${x.m.x ? `<div>${esc(x.m.x)}</div>` : ''}`;
    }
    const closeLightbox = () => { $('#lightbox').classList.remove('open'); $('#lbStage').innerHTML = ''; };
    const stepLightbox = (d) => { lb.i = (lb.i + d + lb.list.length) % lb.list.length; showLightbox(); };
    $('#lbClose').onclick = closeLightbox;
    $('#lbPrev').onclick = () => stepLightbox(-1);
    $('#lbNext').onclick = () => stepLightbox(1);
    $('#lbChat').onclick = () => { const x = lb.list[lb.i]; closeLightbox(); location.hash = `#chat/${x.m.c.ci}/${x.m.i}`; };
    $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lbStage') closeLightbox(); });

    // ---------- charts ----------
    // Bucket keys: month "YYYY-MM", week = Monday "YYYY-MM-DD", day "YYYY-MM-DD".
    const weekStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
    function bucketBy(msgs, unit) {
      const map = new Map();
      for (const m of msgs) {
        if (!m.ts) continue;
        const k = unit === 'month' ? m.month : unit === 'week' ? weekStart(m.ts) : m.t.slice(0, 10);
        const e = map.get(k) || [0, 0];
        e[m.d ? 0 : 1]++;
        map.set(k, e);
      }
      if (!map.size) return { unit, keys: [], map };
      const sorted = [...map.keys()].sort();
      const keys = [];
      if (unit === 'month') {
        for (let y = +sorted[0].slice(0, 4), mo = +sorted[0].slice(5, 7); ; mo++) {
          if (mo > 12) { mo = 1; y++; }
          const k = `${y}-${pad(mo)}`;
          keys.push(k);
          if (k >= sorted[sorted.length - 1]) break;
        }
      } else {
        const step = unit === 'week' ? 7 : 1;
        // +2h keeps the date right when a daylight-saving change shifts midnight.
        for (let d = parseTs(sorted[0]); ; d += step * DAY) {
          const k = ymd(new Date(d + 2 * 3600000));
          if (k > sorted[sorted.length - 1]) break;
          keys.push(k);
        }
      }
      return { unit, keys, map };
    }
    const bucketRange = (unit, k) => unit === 'month'
      ? { from: `${k}-01`, to: ymd(new Date(+k.slice(0, 4), +k.slice(5, 7), 0)) }
      : unit === 'week' ? { from: k, to: ymd(new Date(parseTs(k) + 6 * DAY + 3600000)) } : { from: k, to: k };
    const bucketLabel = (unit, k) => unit === 'month' ? shortMonth(k) : unit === 'week' ? `Week of ${fmtDate(parseTs(k))}` : fmtDay(parseTs(k));

    function barPath(x, y, w, h, r) {
      // Rounded data-end on top, square where the bar meets the baseline.
      r = Math.min(r, w / 2, h);
      return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    }

    // Stacked sent/received bars; every bar is a drill-down target.
    function barChart({ unit, keys, map }, { height = 220, drill: drillTo = 'stats' } = {}) {
      if (!keys.length) return '<div class="gray">No dated messages.</div>';
      const W = 1000; const H = height; const ml = 44; const mr = 8; const mt = 8; const mb = 22;
      const max = Math.max(1, ...keys.map((k) => (map.get(k) || [0, 0]).reduce((a, b) => a + b, 0)));
      const p10 = 10 ** Math.floor(Math.log10(max));
      const top = Math.ceil(max / p10) * p10;
      const sy = (v) => (v / top) * (H - mt - mb);
      const bw = (W - ml - mr) / keys.length;
      const gap = bw > 6 ? 2 : bw > 3 ? 1 : 0;
      let s = '';
      for (let i = 0; i <= 4; i++) {
        const v = (top / 4) * i;
        const y = H - mb - sy(v);
        s += `<line class="gridline" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"></line><text x="${ml - 6}" y="${y + 4}" text-anchor="end">${nf(Math.round(v))}</text>`;
      }
      const every = Math.max(1, Math.ceil(keys.length / 12));
      keys.forEach((k, i) => {
        const [sent, recv] = map.get(k) || [0, 0];
        const x = ml + i * bw + gap / 2;
        const w = Math.max(0.5, bw - gap);
        const hs = sy(sent);
        const hr = sy(recv);
        const base = H - mb;
        if (sent) s += `<path d="${recv ? `M${x},${base}V${base - hs}H${x + w}V${base}Z` : barPath(x, base - hs, w, hs, 3)}" fill="var(--c1)"></path>`;
        if (recv) s += `<path d="${barPath(x, base - hs - hr, w, Math.max(0.5, hr - (sent && hr > 3 ? 2 : 0)), 3)}" fill="var(--c2)"></path>`;
        const r = bucketRange(unit, k);
        s += `<rect class="hit" x="${ml + i * bw}" y="${mt}" width="${bw}" height="${H - mt - mb}" data-drill='${JSON.stringify({ from: r.from, to: r.to, to_view: drillTo })}' data-tip="${esc(bucketLabel(unit, k))}\n${plural(sent + recv, 'message')}\nSent ${nf(sent)} · Received ${nf(recv)}\nClick to see them"></rect>`;
        if (i % every === 0) s += `<text x="${ml + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${unit === 'month' ? (every >= 12 ? k.slice(0, 4) : shortMonth(k)) : fmtDate(parseTs(k)).replace(/,? \d{4}$/, '')}</text>`;
      });
      return `<div class="legend"><span><i style="background:var(--c1)"></i>Sent</span><span><i style="background:var(--c2)"></i>Received</span></div>
        <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Messages per ${unit}">${s}</svg>`;
    }
    const bucketTable = ({ unit, keys, map }) => `<details><summary>Show as table</summary><table class="data-table"><tr><th>${unit === 'month' ? 'Month' : unit === 'week' ? 'Week of' : 'Day'}</th><th class="num">Sent</th><th class="num">Received</th><th class="num">Total</th></tr>${keys.map((k) => { const [a, b] = map.get(k) || [0, 0]; return `<tr><td>${unit === 'month' ? shortMonth(k) : k}</td><td class="num">${nf(a)}</td><td class="num">${nf(b)}</td><td class="num">${nf(a + b)}</td></tr>`; }).join('')}</table></details>`;

    function quantileSteps(values) {
      const vals = values.filter((v) => v).sort((a, b) => a - b);
      const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
      const cuts = vals.length ? [q(1 / 6), q(2 / 6), q(3 / 6), q(4 / 6), q(5 / 6)] : [];
      return (v) => !v ? 0 : 1 + cuts.filter((c) => v > c).length;
    }
    const scaleLegend = () => '<div class="scale">Fewer&nbsp;' + [0, 1, 2, 3, 4, 5, 6].map((i) => `<i style="background:var(--seq-${i})"></i>`).join('') + '&nbsp;More</div>';

    function hourHeatmap(msgs) {
      const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
      let n = 0;
      for (const m of msgs) if (m.ts && m.t.length > 10) { const d = new Date(m.ts); grid[d.getDay()][d.getHours()]++; n++; }
      if (!n) return '<div class="gray">No message times available.</div>';
      const step = quantileSteps(grid.flat());
      const short = (h) => h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
      let html = '<div class="heat"><span></span>' + Array.from({ length: 24 }, (_, h) => `<span class="hl">${h % 3 === 0 ? short(h) : ''}</span>`).join('');
      for (const d of [1, 2, 3, 4, 5, 6, 0]) {
        html += `<span class="lab">${WEEKDAYS[d]}</span>`;
        for (let h = 0; h < 24; h++) html += `<span class="cell" style="background:var(--seq-${step(grid[d][h])})" data-drill='${JSON.stringify({ weekday: d, hour: h })}' data-tip="${WEEKDAYS[d]} ${hourLabel(h)}–${hourLabel((h + 1) % 24)}\n${plural(grid[d][h], 'message')}\nClick to see them"></span>`;
      }
      return html + '</div>' + scaleLegend();
    }

    // GitHub-style calendar: one square per day of the year, weeks as columns.
    function yearCalendar(msgs, year) {
      const counts = new Map();
      for (const m of msgs) if (m.ts && m.t.startsWith(String(year))) counts.set(m.t.slice(0, 10), (counts.get(m.t.slice(0, 10)) || 0) + 1);
      const step = quantileSteps([...counts.values()]);
      const jan1 = new Date(year, 0, 1);
      const start = new Date(jan1);
      start.setDate(1 - ((jan1.getDay() + 6) % 7)); // Monday on or before Jan 1
      const cell = 12; const gap = 2; const left = 28; const topPad = 16;
      let s = '';
      let col = 0;
      let lastMonth = -1;
      for (let d = new Date(start); d.getFullYear() <= year; d.setDate(d.getDate() + 1)) {
        if (d.getFullYear() > year) break;
        const row = (d.getDay() + 6) % 7;
        if (row === 0 && d > start) col++;
        if (d.getFullYear() < year) continue;
        const x = left + col * (cell + gap);
        const y = topPad + row * (cell + gap);
        if (d.getMonth() !== lastMonth && d.getDate() <= 7) { s += `<text x="${x}" y="10">${MONTHS[d.getMonth()].slice(0, 3)}</text>`; lastMonth = d.getMonth(); }
        const k = ymd(d);
        const n = counts.get(k) || 0;
        s += `<rect class="day" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="var(--seq-${step(n)})" data-drill='${JSON.stringify({ from: k, to: k })}' data-tip="${fmtDay(d.getTime())}\n${plural(n, 'message')}${n ? '\nClick to see them' : ''}"></rect>`;
      }
      ['Mon', 'Wed', 'Fri'].forEach((l, i) => { s += `<text x="0" y="${topPad + (i * 2) * (cell + gap) + 10}">${l}</text>`; });
      const W = left + (col + 1) * (cell + gap);
      return `<div class="cal"><svg viewBox="0 0 ${W} ${topPad + 7 * (cell + gap)}" width="${W}" style="max-width:100%;height:auto" role="img" aria-label="Messages per day in ${year}">${s}</svg></div>`;
    }

    function hbars(rows, max, linkFn) {
      return rows.map((r) => `<div class="hbar${linkFn ? ' link' : ''}" ${linkFn ? `data-link="${esc(linkFn(r))}"` : ''} data-tip="${esc(r.label)}\n${plural(r.n, 'message')}${r.share != null ? ` (${Math.round(r.share * 100)}%)` : ''}">
        <span class="name">${esc(r.label)}</span><span class="track"><div class="fill" style="width:${(r.n / max) * 100}%;${r.color ? `background:${r.color}` : ''}"></div></span><span class="num">${nf(r.n)}</span></div>`).join('');
    }

    // ---------- analysis ----------
    fillConvSelect($('#statsScope'));
    const STOP = new Set(('the and for you that this with have are was but not your just can what all get its out like got how she him her his they them then than there their when will would could should about from been were one did into our more some any too only also very really yeah yes okay lol haha the' +
      ' it\'s i\'m don\'t that\'s can\'t didn\'t i\'ll you\'re i\'ve isn\'t won\'t let\'s what\'s there\'s doesn\'t wasn\'t https http www com').split(' '));

    function statsPeriod() {
      const v = $('#statsPeriod').value;
      const today = new Date();
      $('#statsCustom').hidden = v !== 'custom';
      let r = null;
      if (v === 'custom') r = ($('#stFrom').value || $('#stTo').value) ? { from: $('#stFrom').value || '1970-01-01', to: $('#stTo').value || ymd(today) } : null;
      else if (v === 'year') r = { from: `${today.getFullYear()}-01-01`, to: ymd(today) };
      else if (v === 'lastyear') r = { from: `${today.getFullYear() - 1}-01-01`, to: `${today.getFullYear() - 1}-12-31` };
      else if (v !== 'all') { const f = new Date(today); f.setDate(f.getDate() - (+v - 1)); r = { from: ymd(f), to: ymd(today) }; }
      $('#statsPeriodLabel').textContent = r && v !== 'custom' ? `${r.from} to ${r.to}` : '';
      return r;
    }

    let calYear = null;
    function renderStats() {
      const scope = $('#statsScope').value;
      const conv = scope === 'all' ? null : D.conversations[scope];
      fillPeople($('#statsPerson'), scope, 'Everyone');
      const person = $('#statsPerson').value;
      const period = statsPeriod();
      const convs = conv ? [conv] : D.conversations;
      const inPeriod = (m) => !period || (m.t && m.t.slice(0, 10) >= period.from && m.t.slice(0, 10) <= period.to);
      const scoped = (conv ? conv.messages : ALL).filter(inPeriod);
      const msgs = person ? scoped.filter((m) => m.s === person) : scoped;
      const body = $('#statsBody');
      const base = { conv: conv ? conv.ci : null, person: person || null };
      body.dataset.base = JSON.stringify({ ...base, ...(period || {}) });
      if (!msgs.length) {
        const newest = (conv ? conv.messages : ALL).reduce((a, m) => Math.max(a, m.ts || 0), 0);
        body.innerHTML = `<div class="panel empty">No messages in this period.${newest ? ` The newest message is from ${fmtDate(newest)}.` : ''}</div>`;
        return;
      }

      const sent = msgs.filter((m) => m.d).length;
      const media = msgs.reduce((n, m) => n + m.m.length, 0);
      const dated = msgs.filter((m) => m.ts).sort((a, b) => a.ts - b.ts);
      const days = new Map();
      for (const m of dated) days.set(m.t.slice(0, 10), (days.get(m.t.slice(0, 10)) || 0) + 1);
      const busiest = [...days].sort((a, b) => b[1] - a[1])[0];
      const words = (s) => (s.match(/[\p{L}\p{N}']+/gu) || []).length;
      const totalWords = msgs.reduce((n, m) => n + words(m.x), 0);

      // Longest run of consecutive active days.
      const dayKeys = [...days.keys()].sort();
      let streak = { n: 0, from: null, to: null };
      for (let i = 0, run = 0, from = null; i < dayKeys.length; i++) {
        const contiguous = i && Math.round((parseTs(dayKeys[i]) - parseTs(dayKeys[i - 1])) / DAY) === 1;
        run = contiguous ? run + 1 : 1;
        from = contiguous ? from : dayKeys[i];
        if (run > streak.n) streak = { n: run, from, to: dayKeys[i] };
      }

      // Per conversation, in order: reply gaps, who starts conversations (first
      // message after 6+ hours of quiet), and the longest silences.
      const replyMine = [];
      const replyTheirs = [];
      const starts = new Map();
      const silences = [];
      const perPerson = new Map();
      const pp = (name) => { if (!perPerson.has(name)) perPerson.set(name, { name, n: 0, words: 0, media: 0, first: null, last: null, starts: 0, replies: [] }); return perPerson.get(name); };
      for (const c of convs) {
        // Work in time order: saved order can differ (e.g. messages merged from
        // separate runs), and out-of-order pairs used to hide real gaps.
        const ms = c.messages.filter((m) => m.ts && inPeriod(m)).map((m, k) => [m, k]).sort((x, y) => x[0].ts - y[0].ts || x[1] - y[1]).map(([m]) => m);
        for (let i = 0; i < ms.length; i++) {
          const b = ms[i];
          const p = pp(b.s);
          p.n++; p.words += words(b.rxOf ? '' : b.x); p.media += b.m.length;
          if (!p.first || b.ts < p.first) p.first = b.ts;
          if (!p.last || b.ts > p.last) p.last = b.ts;
          const a = ms[i - 1];
          const gap = a ? b.ts - a.ts : Infinity;
          if (gap >= 6 * 3600000) { starts.set(b.s, (starts.get(b.s) || 0) + 1); p.starts++; }
          // Silences need exact times on both sides, not a time borrowed from a date heading.
          if (a && gap > 0 && !a.p && !b.p && a.t.length > 10 && b.t.length > 10) silences.push({ gap, a, b });
          if (a && a.d !== b.d && !a.p && !b.p && gap >= 0 && gap <= 12 * 3600000) {
            (b.d ? replyMine : replyTheirs).push(gap);
            p.replies.push(gap);
          }
        }
      }
      const myReplies = person && person !== 'Me' ? [] : replyMine;
      const theirReplies = person && person !== 'Me' ? perPerson.get(person)?.replies || [] : replyTheirs;

      const card = (k, v, s = '', tipText = '') => `<div class="stat-card"${tipText ? ` data-tip="${esc(tipText)}"` : ''}><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
      let html = '<div class="cards">' +
        card('Messages', nf(msgs.length), conv ? esc(conv.title) : plural(convs.length, 'conversation')) +
        card('Sent by you', nf(sent), `${Math.round((sent / msgs.length) * 100)}% of messages`) +
        card('Received', nf(msgs.length - sent)) +
        card('Photos, GIFs & videos', nf(media)) +
        card('First – last', dated.length ? fmtDate(dated[0].ts) : '—', dated.length ? `to ${fmtDate(dated[dated.length - 1].ts)}` : '') +
        card('Active days', nf(days.size), days.size ? `${(dated.length / days.size).toFixed(1)} messages per active day` : '') +
        card('Busiest day', busiest ? nf(busiest[1]) : '—', busiest ? fmtDate(parseTs(busiest[0])) : '') +
        card('Longest streak', streak.n ? plural(streak.n, 'day') : '—', streak.n > 1 ? `${fmtDate(parseTs(streak.from))} – ${fmtDate(parseTs(streak.to))}` : 'messages on consecutive days') +
        card('Words per message', msgs.length ? (totalWords / msgs.length).toFixed(1) : '—', `${nf(totalWords)} words in all`) +
        card('Your typical reply', fmtDur(median(myReplies)), myReplies.length ? `median of ${nf(myReplies.length)} replies` : 'not enough data', 'Time from a received message to your next message, where both have exact times and the gap is under 12 hours.') +
        card('Their typical reply', fmtDur(median(theirReplies)), theirReplies.length ? `median of ${nf(theirReplies.length)} replies` : 'not enough data', 'Time from your message to their next message, under 12 hours.') +
        card('Conversations started', starts.get('Me') != null ? `${nf(starts.get('Me'))} by you` : '0 by you', `${nf([...starts].filter(([k]) => k !== 'Me').reduce((n, [, v]) => n + v, 0))} by others`, 'A conversation starts with the first message after 6 or more hours of quiet.') +
        '</div>';

      const monthly = bucketBy(msgs, 'month');
      const weekly = bucketBy(msgs, 'week');
      html += `<div class="panel"><h3>Messages per month</h3><div class="sub">Click a month to see its messages.</div>${barChart(monthly)}${bucketTable(monthly)}</div>`;
      html += `<div class="panel"><h3>Weekly breakout</h3><div class="sub">Messages each week (weeks start Monday). Click a week to see its messages.</div>${barChart(weekly, { height: 200 })}${bucketTable(weekly)}</div>`;

      const years = [...new Set(dated.map((m) => +m.t.slice(0, 4)))].sort();
      if (!years.includes(calYear)) calYear = years[years.length - 1];
      const yMsgs = dated.filter((m) => +m.t.slice(0, 4) === calYear);
      const yDays = new Map();
      for (const m of yMsgs) yDays.set(m.t.slice(0, 10), (yDays.get(m.t.slice(0, 10)) || 0) + 1);
      const yBusiest = [...yDays].sort((a, b) => b[1] - a[1])[0];
      const yMonths = new Map();
      for (const m of yMsgs) yMonths.set(m.month, (yMonths.get(m.month) || 0) + 1);
      const yTopMonth = [...yMonths].sort((a, b) => b[1] - a[1])[0];
      const yPeople = new Map();
      for (const m of yMsgs) if (m.s !== 'Me') yPeople.set(m.s, (yPeople.get(m.s) || 0) + 1);
      const yTopPerson = [...yPeople].sort((a, b) => b[1] - a[1])[0];
      html += `<div class="panel"><h3>Year in review <span class="right"><select id="calYear">${years.map((y) => `<option${y === calYear ? ' selected' : ''}>${y}</option>`).join('')}</select></span></h3>
        <div class="sub">Every day of ${calYear}. Click a day to read it.</div>${yearCalendar(dated, calYear)}${scaleLegend()}
        <div class="yearstats"><div><b>${nf(yMsgs.length)}</b><span class="secondary">messages</span></div><div><b>${nf(yDays.size)}</b><span class="secondary">active days</span></div>
        <div><b>${yBusiest ? `${fmtDate(parseTs(yBusiest[0]))}` : '—'}</b><span class="secondary">busiest day${yBusiest ? ` (${nf(yBusiest[1])})` : ''}</span></div>
        <div><b>${yTopMonth ? monthLabel(yTopMonth[0]).split(' ')[0] : '—'}</b><span class="secondary">busiest month${yTopMonth ? ` (${nf(yTopMonth[1])})` : ''}</span></div>
        ${yTopPerson ? `<div><b>${esc(yTopPerson[0])}</b><span class="secondary">sent you the most (${nf(yTopPerson[1])})</span></div>` : ''}</div></div>`;

      html += `<div class="panel"><h3>Day of week and hour</h3><div class="sub">When messages are sent, in local time. Click a square to see those messages.</div>${hourHeatmap(msgs)}</div>`;

      const people = [...perPerson.values()].filter((p) => !person || p.name === person).sort((a, b) => b.n - a.n);
      html += `<div class="panel"><h3>People</h3><div class="sub">Click a person to focus the analysis on them.</div><div style="overflow-x:auto"><table class="people-table">
        <tr><th>Person</th><th class="num">Messages</th><th class="num">Share</th><th class="num">Words</th><th class="num">Avg words</th><th class="num">Media</th><th class="num">Started</th><th class="num">Typical reply</th><th>First</th><th>Last</th></tr>
        ${people.slice(0, 60).map((p) => `<tr class="link-row" data-person="${esc(p.name)}"><td>${avatar(p.name, (conv || D.conversations.find((c) => c.color.has(p.name)))?.color.get(p.name), 'sm')} ${esc(p.name)}</td>
          <td class="num">${nf(p.n)}</td><td class="num">${Math.round((p.n / scoped.length) * 100)}%</td><td class="num">${nf(p.words)}</td><td class="num">${p.n ? (p.words / p.n).toFixed(1) : '—'}</td>
          <td class="num">${nf(p.media)}</td><td class="num">${nf(p.starts)}</td><td class="num">${fmtDur(median(p.replies))}</td><td>${fmtDate(p.first)}</td><td>${fmtDate(p.last)}</td></tr>`).join('')}
        </table></div></div>`;

      if (!conv) {
        const convRows = D.conversations.map((c) => ({ label: c.title, ci: c.ci, n: c.messages.filter((m) => inPeriod(m) && (!person || m.s === person)).length }))
          .filter((r) => r.n).sort((a, b) => b.n - a.n).slice(0, 12);
        if (convRows.length > 1) html += `<div class="panel"><h3>Biggest conversations</h3><div class="sub">Click one to analyze it.</div>${hbars(convRows, convRows[0].n, (r) => `#stats/${r.ci}`)}</div>`;
      }

      // Reply-time distribution
      const BUCKETS = [[60000, '< 1 min'], [5 * 60000, '1–5 min'], [15 * 60000, '5–15 min'], [3600000, '15–60 min'], [3 * 3600000, '1–3 hr'], [Infinity, '3–12 hr']];
      const dist = (arr) => BUCKETS.map(([lim], i) => arr.filter((g) => g < lim && (i === 0 || g >= BUCKETS[i - 1][0])).length);
      const dm = dist(myReplies);
      const dt = dist(theirReplies);
      const dmax = Math.max(1, ...dm, ...dt);
      html += `<div class="two"><div class="panel"><h3>How fast replies come</h3><div class="sub">Time to reply, where both messages have exact times.</div>
        <div class="legend"><span><i style="background:var(--c1)"></i>You</span><span><i style="background:var(--c2)"></i>${person && person !== 'Me' ? esc(person) : 'Them'}</span></div>
        ${BUCKETS.map(([, l], i) => `<div class="hbar" data-tip="${l}\nYou: ${nf(dm[i])} · ${person && person !== 'Me' ? esc(person) : 'Them'}: ${nf(dt[i])}"><span class="name">${l}</span><span class="track" style="display:flex;flex-direction:column;gap:2px;height:14px"><div class="fill" style="height:6px;width:${(dm[i] / dmax) * 100}%"></div><div class="fill" style="height:6px;background:var(--c2);width:${(dt[i] / dmax) * 100}%"></div></span><span class="num">${nf(dm[i])} / ${nf(dt[i])}</span></div>`).join('')}</div>`;
      const topSil = silences.sort((x, y) => y.gap - x.gap).slice(0, 8);
      const who = (n) => (n === 'Me' ? 'You' : esc(n));
      html += `<div class="panel"><h3>Longest silences</h3><div class="sub">The biggest gaps between two messages in a chat, in time order. Click one to see where the conversation picked up again.</div>
        <table style="width:100%">${topSil.map((s) => `<tr class="link-row" data-goto="${s.b.c.ci}/${s.b.i}"><td><b>${fmtDur(s.gap)}</b></td><td class="gray">${esc(fmtWhen(s.a))} → ${esc(fmtWhen(s.b))}</td><td>${who(s.b.s)} wrote first after it${conv ? '' : ` · ${esc(s.b.c.title)}`}</td></tr>`).join('') || '<tr><td class="gray">Not enough messages with exact times.</td></tr>'}</table></div></div>`;

      // Mentioned: links, emails, phone numbers.
      const domains = new Map();
      const emails = new Map();
      const phones = new Map();
      for (const m of msgs) {
        for (const u of m.x.match(URL_RE) || []) {
          let host = u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase();
          domains.set(host, (domains.get(host) || 0) + 1);
        }
        for (const e of m.x.match(EMAIL_RE) || []) emails.set(e.toLowerCase(), (emails.get(e.toLowerCase()) || 0) + 1);
        for (const p of m.x.match(PHONE_RE) || []) { const digits = p.replace(/\D/g, ''); if (digits.length >= 10 && digits.length <= 15) phones.set(p.trim(), (phones.get(p.trim()) || 0) + 1); }
      }
      const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n);
      const chips = (list) => list.length ? `<div class="words">${list.map(([w, n]) => `<button class="chip" data-word="${esc(w)}" title="Search for ${esc(w)}">${esc(w)}<span class="n">${nf(n)}</span></button>`).join('')}</div>` : '<div class="gray">None.</div>';
      html += `<div class="panel"><h3>Mentioned</h3><div class="sub">Links, email addresses and phone numbers that appear in messages. Click one to find every message with it.</div>
        <div class="two"><div><b>Websites</b>${chips(top(domains, 30))}</div><div><b>Emails</b>${chips(top(emails, 20))}<div style="height:10px"></div><b>Phone numbers</b>${chips(top(phones, 20))}</div></div></div>`;

      const wordMap = new Map();
      const emoji = new Map();
      for (const m of msgs) {
        // A reaction sent as a text counts as its emoji, not the words it quotes.
        const text = m.rxOf ? reactionOf(m.x)?.e || '' : m.x;
        for (const w of text.replace(URL_RE, ' ').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}']{2,}/gu) || []) if (!STOP.has(w) && !/^\d+$/.test(w)) wordMap.set(w, (wordMap.get(w) || 0) + 1);
        for (const e of text.match(/\p{Extended_Pictographic}/gu) || []) emoji.set(e, (emoji.get(e) || 0) + 1);
      }
      html += `<div class="two"><div class="panel"><h3>Most used words</h3><div class="sub">Common filler words left out. Click to search.</div>${chips(top(wordMap, 40))}</div>`;
      html += `<div class="panel"><h3>Most used emoji</h3><div class="sub">Click to search.</div>${chips(top(emoji, 24))}</div></div>`;

      body.innerHTML = html;
      $('#calYear')?.addEventListener('change', (e) => { calYear = +e.target.value; renderStats(); });
    }
    $('#statsScope').addEventListener('change', () => { $('#statsPerson').value = ''; location.hash = `#stats/${$('#statsScope').value}`; });
    ['#statsPerson', '#statsPeriod', '#stFrom', '#stTo'].forEach((s) => $(s).addEventListener('change', renderStats));
    $('#statsBody').addEventListener('click', (e) => {
      const base = JSON.parse($('#statsBody').dataset.base || '{}');
      const d = e.target.closest('[data-drill]');
      if (d) {
        const f = JSON.parse(d.dataset.drill);
        // A chart's own date range wins; otherwise keep the period being viewed.
        return drill({ ...base, ...f, from: f.from || base.from, to: f.to || base.to });
      }
      const w = e.target.closest('[data-word]');
      if (w) return drill({ ...base, q: w.dataset.word, sort: 'new' });
      const p = e.target.closest('[data-person]');
      if (p) { $('#statsPerson').value = p.dataset.person; return renderStats(); }
      const g = e.target.closest('[data-goto]');
      if (g) { location.hash = `#chat/${g.dataset.goto}`; return; }
      const l = e.target.closest('[data-link]');
      if (l) location.hash = l.dataset.link;
    });
    // Search's own trend chart narrows the search to the clicked month.
    $('#results').addEventListener('click', (e) => {
      const d = e.target.closest('[data-drill]');
      if (!d) return;
      const f = JSON.parse(d.dataset.drill);
      $('#sFrom').value = f.from;
      $('#sTo').value = f.to;
      runSearch();
    });

    // ---------- about / forensic ----------
    function renderAbout() {
      const info = D.info || {};
      const runs = info.runs || [];
      const dl = (rows) => `<dl>${rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
      let html = `<div class="panel"><h3>About this ${D.live ? 'analysis' : 'archive'}</h3><div class="sub">${D.live ? 'Read live from the Messages page. Nothing was saved.' : 'Details recorded when the archive was made and each time it was updated.'}</div>` +
        dl([
          ['Tool', esc(`${info.tool || 'Message Archivist'} ${info.version || ''}`)],
          ['Created', D.exported_at ? esc(new Date(D.exported_at).toLocaleString()) : null],
          ['Last updated', D.updated_at ? esc(new Date(D.updated_at).toLocaleString()) : null],
          ['Timezone of times shown', esc(info.timezone || '')],
          ['Browser', esc(info.user_agent || '')],
          ['Sources', esc([...new Set(D.conversations.map(srcName))].map((a) => `${a} (${D.conversations.filter((c) => srcName(c) === a).length})`).join(', '))],
          ['Kept apart', Object.keys(KINDS).some((k) => D.conversations.some((c) => c.kind === k)) ? `${Object.entries(KINDS).map(([k, v]) => [v, D.conversations.filter((c) => c.kind === k).length]).filter(([, n]) => n).map(([v, n]) => `${v.icon} ${esc(v.long)} ${nf(n)}`).join(' · ')}${SHOW_ALL ? ' (shown everywhere)' : ' (in their own folders in Chats; Settings can leave them out of the backup)'}` : 'None'],
          ['People', `${nf(PPL.list.length)} in one-to-one chats${PPL.list.some((p) => p.services.length > 1) ? `, ${nf(PPL.list.filter((p) => p.services.length > 1).length)} of them in more than one app` : ''}${PPL.suggestions.length ? ` · <a href="#people/~matches">${nf(PPL.suggestions.length)} possible matches</a>` : ''}`],
          ['Case reference', esc(info.case_note || '')],
          ['Contents', `${plural(D.conversations.length, 'conversation')}, ${plural(ALL.length, 'message')}, ${plural(MEDIA.length, 'media file')}`],
        ]) + '</div>';
      if (!D.live) {
        html += `<div class="panel"><h3>Verifying this copy</h3><div class="sub">Every file has a SHA-256 checksum in SHA256SUMS.txt. If any listed file has been changed, corrupted or removed, the check reports it. Files added afterwards aren’t listed, so they don’t affect the check.</div>
          <p>On a Mac or Linux, open Terminal in this folder and run <code>shasum -a 256 -c SHA256SUMS.txt</code>. On Windows PowerShell: <code>Get-FileHash -Algorithm SHA256 &lt;file&gt;</code> and compare with the list.</p>
          <p class="gray">Each photo's checksum is also shown in the photo viewer and in messages.csv. Full logs of every run are in the logs folder.</p></div>`;
      }
      if (runs.length) {
        html += `<div class="panel"><h3>History</h3><div class="sub">Every export and update of this archive.</div><div style="overflow-x:auto"><table style="width:100%">
          <tr><th>When</th><th>What</th><th>Chats</th><th class="num">Messages added</th><th class="num">Media added</th><th>Range</th><th>Photos</th></tr>
          ${runs.map((r) => `<tr><td>${esc(new Date(r.started_at).toLocaleString())}</td><td>${esc(r.kind)}</td><td>${esc((r.chats || []).join(', '))}</td><td class="num">${nf(r.added_messages || 0)}</td><td class="num">${nf(r.added_media || 0)}${r.failed_media ? ` <span class="error">(${nf(r.failed_media)} failed)</span>` : ''}</td><td>${r.range ? esc(`${r.range.from} to ${r.range.to}`) : 'all'}</td><td>${r.full_size ? 'full size' : 'thumbnails'}</td></tr>`).join('')}
          </table></div></div>`;
      }
      const cards = D.conversations.filter((c) => c.contact?.people?.length);
      if (cards.length) {
        html += `<div class="panel"><h3>Contacts</h3><div class="sub">As shown on each chat’s Details page in Google Messages when it was saved.</div><div style="overflow-x:auto"><table style="width:100%"><tr><th>Chat</th><th>Person</th><th>Number</th><th>End-to-end encrypted</th><th>Read</th></tr>
          ${cards.flatMap((c) => c.contact.people.map((p, k) => `<tr class="link-row" data-goto="${c.ci}"><td>${k ? '' : esc(c.title)}</td><td style="display:flex;gap:10px;align-items:center">${avatar(p.n, c.color.get(p.n) || personColor(p.n), 'sm')} ${esc(p.n)}</td><td>${esc(p.num || '')}</td><td>${k ? '' : c.contact.e2ee == null ? 'unknown' : c.contact.e2ee ? 'yes' : 'no'}</td><td class="gray">${k || !c.contact.at ? '' : esc(fmtDate(Date.parse(c.contact.at)))}</td></tr>`)).join('')}
          </table></div></div>`;
      }
      const V = D.verification;
      if (V && !D.live) {
        const cov = V.coverage;
        const done = V.verified + V.complete;
        html += `<div class="panel"><h3>Completeness</h3><div class="sub">Each chat is checked every time it’s saved: that its first message was reached (and on what evidence), that the newest messages on screen are all saved, that there are no duplicates, and that every photo and video was saved. The details are in each chat’s progress.json and in verification.json.</div>` +
          dl([
            ['Chats', `${nf(V.chats)}: ${nf(done)} complete${V.verified ? ` (${nf(V.verified)} with every check passed)` : ''}${V.incomplete ? `, <span class="st warn">${nf(V.incomplete)} unfinished</span>` : ''}${V.problem ? `, <span class="st bad">${nf(V.problem)} need attention</span>` : ''}`],
            ['Conversations in Messages', cov ? `${nf(cov.backed_up)} of ${nf(cov.in_messages)} completely backed up${cov.not_backed_up ? `, ${nf(cov.not_backed_up)} not backed up yet` : ''}${cov.unfinished ? `, ${nf(cov.unfinished)} unfinished` : ''} (list read ${esc(fmtDate(Date.parse(cov.scanned_at)))})` : '“Back up everything” in the extension’s Settings checks every conversation in Messages against this archive.'],
            ['Checked', V.checked_at ? esc(new Date(V.checked_at).toLocaleString()) : null],
          ]) + '</div>';
      }
      const withStatus = D.conversations.some((c) => c.status);
      html += `<div class="panel"><h3>Conversations</h3><div style="overflow-x:auto"><table style="width:100%"><tr><th>Name</th>${withStatus ? '<th>Status</th>' : ''}<th>Google conversation ID</th><th class="num">Messages</th><th class="num">Media</th><th>First</th><th>Last</th><th>Folder</th></tr>
        ${D.conversations.map((c) => `<tr class="link-row" data-goto="${c.ci}"><td>${esc(c.title)}</td>${withStatus ? `<td>${statusPill(c)}${c.problems?.length ? `<div class="gray" style="font-size:12px">${esc(c.problems.join(', '))}</div>` : ''}</td>` : ''}<td class="gray">${esc(c.id || '')}</td><td class="num">${nf(c.messages.length)}</td><td class="num">${nf(c.messages.reduce((n, m) => n + m.m.filter((x) => x.f).length, 0))}${c.media_failed ? ` <span class="error">(${nf(c.media_failed)} failed)</span>` : ''}</td><td>${fmtDate(c.first)}</td><td>${fmtDate(c.last)}</td><td class="gray">${esc(c.folder || '')}</td></tr>`).join('')}
        </table></div></div>`;
      if (D.skipped?.length) html += `<div class="panel"><h3>Skipped</h3>${D.skipped.map((s) => `<div class="gray">${esc(s.title)}: ${esc(s.error)}</div>`).join('')}</div>`;
      const nFlags = Object.keys(FLAGS).filter((k) => BY_KEY.has(k)).length;
      html = `<div class="panel"><h3>Flags</h3><div class="sub">${canLabel ? 'Flags and notes are saved in your backup folder, in labels.json with your labels.' : 'Flags and notes are kept in this browser.'} The Review tab lists them all. Export them to a file to keep a copy or share them; whoever opens the same archive can import the file to see your flags.</div>
        <div class="row"><b>${plural(nFlags, 'flagged message')}</b><span style="flex:1"></span>
        <button class="tonal" id="flagsExport"${nFlags ? '' : ' disabled'}>Export flags…</button><button class="outlined" id="flagsImport">Import flags…</button>
        <input type="file" id="flagsFile" accept=".json,application/json" hidden></div><div class="secondary" id="flagsMsg" style="margin-top:8px"></div></div>` + html;
      $('#aboutBody').innerHTML = html;
    }
    $('#aboutBody').addEventListener('click', (e) => {
      const g = e.target.closest('[data-goto]');
      if (g) location.hash = `#chat/${g.dataset.goto}`;
      if (e.target.id === 'flagsExport') exportFlags();
      if (e.target.id === 'flagsImport') $('#flagsFile').click();
    });
    $('#aboutBody').addEventListener('change', (e) => { if (e.target.id === 'flagsFile' && e.target.files[0]) importFlags(e.target.files[0]); });

    // A flags file identifies each message by chat and message ID, and also
    // carries its time, sender and text so a reader can check it by eye.
    function exportFlags() {
      const flags = Object.entries(FLAGS).filter(([k]) => BY_KEY.has(k)).map(([key, f]) => {
        const m = BY_KEY.get(key);
        return { key, note: f.note, flagged_at: f.at, conversation: m.c.title, conversation_id: m.c.id || null, message_id: m.id || null, timestamp: m.t, sender: m.s, text: m.x.slice(0, 500) };
      });
      const file = { type: 'message-archivist-flags', version: 1, archive_created: D.exported_at || null, exported_at: new Date().toISOString(), case_note: D.info?.case_note || '', flags };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
      a.download = `flags ${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }

    async function importFlags(fileObj) {
      let file;
      try { file = JSON.parse(await fileObj.text()); } catch { $('#flagsMsg').textContent = 'That file isn’t a flags file.'; return; }
      if (!['message-archivist-flags', 'google-messages-exporter-flags'].includes(file?.type) || !Array.isArray(file.flags)) { $('#flagsMsg').textContent = 'That file isn’t a flags file from this tool.'; return; }
      let added = 0;
      let updated = 0;
      let missing = 0;
      for (const f of file.flags) {
        // Match by key, or by chat + time + sender + text if IDs differ.
        let m = BY_KEY.get(f.key);
        if (!m) m = ALL.find((x) => x.t === f.timestamp && x.s === f.sender && x.x.slice(0, 500) === f.text && (!f.conversation_id || x.c.id === f.conversation_id || x.c.title === f.conversation));
        if (!m) { missing++; continue; }
        const k = flagKey(m);
        if (FLAGS[k]) {
          if (f.note && !FLAGS[k].note.includes(f.note)) { FLAGS[k].note = FLAGS[k].note ? `${FLAGS[k].note} / ${f.note}` : f.note; updated++; }
        } else { FLAGS[k] = { note: f.note || '', at: f.flagged_at || new Date().toISOString() }; added++; }
      }
      saveFlags();
      updateFlagCount();
      renderAbout();
      $('#flagsMsg').textContent = `Imported: ${plural(added, 'new flag')}${updated ? `, ${plural(updated, 'note')} merged` : ''}${missing ? `. ${plural(missing, 'flagged message')} aren’t in this archive.` : '.'}`;
      if (state.conv) renderChat();
    }

    // ---------- routing ----------
    // #chat/<conversation>/<message>, #people/<a chat of theirs>, #search, #media, #review, #stats/<conversation|all>, #about,
    // #labels/<Google conversation ID or folder>, which opens that chat's labels,
    // and #chat-id/<Google conversation ID>.
    let mediaRendered = false;
    function route() {
      const [view = 'chat', a, b] = location.hash.slice(1).split('/');
      if (view === 'chat-id') {
        // From Settings' list of chats: open a chat by its Google conversation ID.
        const id = decodeURIComponent(a || '');
        const c = D.conversations.find((x) => x.id === id);
        history.replaceState(null, '', c ? `#chat/${c.ci}` : '#chat');
        route();
        return;
      }
      if (view === 'labels') {
        const id = decodeURIComponent(a || '');
        const c = D.conversations.find((x) => x.id === id || x.folder === id);
        history.replaceState(null, '', c ? `#chat/${c.ci}` : '#chat');
        route();
        if (c) setTimeout(() => labelMenu($('#chatLabels'), { chat: c }), 50);
        return;
      }
      const name = { chat: 'chats', people: 'people', contacts: 'contacts', search: 'search', media: 'media', review: 'review', stats: 'stats', about: 'about' }[view] || 'chats';
      document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
      document.querySelectorAll('nav a').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
      // In Settings, its menu has the views: tell it which one this is.
      if (EMBEDDED) parent.postMessage({ type: 'ma-view', view: name }, location.origin);
      closeLightbox();
      tip.style.display = 'none';
      if (name === 'chats') {
        // On a narrow screen the list and a chat take turns: a chat picked by name shows on its own.
        $('#view-chats').classList.toggle('picked', a != null && a !== '');
        const ci = a != null && a !== '' ? +a : state.conv ? state.conv.ci : [...D.conversations].sort((x, y) => (y.last || 0) - (x.last || 0))[0]?.ci;
        if (ci != null) openChat(ci, b != null ? +b : undefined);
        else renderChat();
      } else if (name === 'people') {
        // #people/<a chat of theirs>, or #people/~matches for the same-name suggestions.
        const key = a ? decodeURIComponent(a) : '';
        pplState.matches = key === '~matches';
        $('#view-people').classList.toggle('picked', !!key);
        pplState.person = pplState.matches ? null : (key && personByKey(key)) || (pplState.person && personByKey(pplState.person.key)) || [...PPL.list].sort((x, y) => y.count - x.count)[0] || null;
        renderPeopleList();
        renderPerson();
        $('#pplList .conv.active')?.scrollIntoView({ block: 'nearest' });
      } else if (name === 'contacts') {
        renderContacts();
      } else if (name === 'search') {
        runSearch();
        $('#q').focus();
      } else if (name === 'media') {
        if (!mediaRendered) { renderMedia(); mediaRendered = true; } else mediaRail.measure();
      } else if (name === 'review') {
        renderReview();
      } else if (name === 'stats') {
        const scope = a && a !== 'all' && D.conversations[a] ? a : D.live && D.conversations.length === 1 ? '0' : 'all';
        if ($('#statsScope').value !== scope) $('#statsPerson').value = '';
        $('#statsScope').value = scope;
        renderStats();
      } else if (name === 'about') {
        renderAbout();
      }
    }
    addEventListener('hashchange', route);

    // ---------- keyboard ----------
    document.addEventListener('keydown', (e) => {
      if ($('#lightbox').classList.contains('open')) {
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') stepLightbox(-1);
        else if (e.key === 'ArrowRight') stepLightbox(1);
        return;
      }
      if (!$('#help').hidden && (e.key === 'Escape' || e.key === '?')) { $('#help').hidden = true; return; }
      // Typing in a text field or menu isn't a shortcut; a focused checkbox or button is fine.
      if (document.activeElement.matches('input:not([type="checkbox"]):not([type="radio"]), select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      const v = document.querySelector('.view.active').id;
      const tabs = { 1: '#chat', 2: '#people', 3: '#contacts', 4: '#search', 5: '#media', 6: '#review', 7: '#stats', 8: '#about' };
      if (e.key === '/') {
        e.preventDefault();
        (v === 'view-chats' ? $('#chatSearch') : v === 'view-people' ? $('#pplFilter') : v === 'view-contacts' ? $('#ctFilter') : v === 'view-review' ? $('#rFind') : $('#q')).focus();
        if (v !== 'view-chats' && v !== 'view-people' && v !== 'view-contacts' && v !== 'view-search' && v !== 'view-review') location.hash = '#search';
      } else if (tabs[e.key]) {
        location.hash = tabs[e.key];
      } else if (e.key === '?') {
        $('#help').hidden = false;
      } else if (e.key === 't') {
        window.GMTheme?.toggle();
      } else if (e.key === 'p') {
        if (v === 'view-chats') $('#chatPrint').click(); else if (v === 'view-search') $('#sPrint').click(); else if (v === 'view-review') $('#rPrint').click();
      } else if (v === 'view-chats' && (e.key === 'n' || e.key === 'N')) {
        goHit(state.hit + (e.key === 'N' ? -1 : 1));
      } else if ((v === 'view-chats' || v === 'view-people') && (e.key === 'j' || e.key === 'k')) {
        // Next / previous conversation (or person) in the list.
        const items = [...document.querySelectorAll(`#${v} .conv`)];
        const i = items.findIndex((b) => b.classList.contains('active'));
        items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'j' ? 1 : -1)))]?.click();
      }
    });
    // Opened from Settings (or the app's home): the way back. Not in the copy kept in the backup folder.
    if (LIBRARY && !EMBEDDED && globalThis.chrome?.runtime?.sendMessage) {
      $('#settingsBtn').hidden = false;
      $('#settingsBtn').onclick = () => toSettings('home');
    }
    $('#helpBtn').onclick = () => { $('#help').hidden = false; };
    $('#help').addEventListener('click', (e) => { if (e.target.id === 'help' || e.target.closest('.close')) $('#help').hidden = true; });
    updateFlagCount();

    renderConvList();
    if (D.live && !location.hash) location.hash = '#stats/0';
    else route();
  }
})();
