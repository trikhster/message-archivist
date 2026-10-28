// Message Archivist on Snapchat for Web (www.snapchat.com/web): keeps the
// chats you open there, as you read them, for your archive. Snapchat's own
// download has only saved messages; this fills in the rest while they're
// still on screen. Registered for these pages only when it's turned on in
// Settings → Apps → Snapchat (Chrome asks to let it read snapchat.com).
//
// It only reads what the page already holds: its HTML, and the chat photos
// and videos the page has loaded into its own blobs/cache for you to see. It
// never clicks, types, scrolls or changes anything on the page, never opens a
// Snap, never saves a message in Snapchat, never fetches anything from
// Snapchat's servers, and never takes a screenshot or captures the screen:
// nothing about how Snapchat works for you changes, and nobody is notified of
// anything. Snaps (the photos and videos you tap to view, gone once seen)
// aren't chat messages, so they aren't read at all. A chat photo or video is
// saved only once you've scrolled it on screen (its picture is a blob the
// page already has); stickers (served from Snapchat's CDN) are noted, not
// saved. What it reads goes to the extension (background `gm-web-capture` for
// the messages, `gm-web-media` for the pictures), which keeps it until
// Settings puts it in the archive. It logs nothing.
(() => {
  // Once per page. Started again after the extension is updated or reloaded
  // (the copy before it is cut off then, and stops).
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  if (window.__maSnapchat?.alive?.()) return;
  window.__maSnapchat = { alive };

  // Snapchat for Web is a React app with generated class names. These are the
  // only coupling to its markup (read on the live page, 2026-10-27); if
  // Snapchat changes it, fix them here.
  const SEL = {
    list: 'ul.MibAa', // the open chat's messages, oldest first
    title: '.k1IaM span.bIpkz', // the open chat's name, above them
    group: 'ul.ujRzj', // one sender's messages in a row
    message: ':scope > li', // one message of a group
    header: ':scope > header', // on a group's first message: who and when
    who: '.GUB_w', // the sender's name ("ME" for you)
    when: 'time[datetime]', // when, as an exact ISO time
    bubble: 'div.KB4Aq',
    text: 'span.ogn1z', // a message's words
    reply: 'div.z_6Hk', // the message a reply quotes, above its words
    replyWho: '.SGcAb',
    media: 'div.j13IG, div.ET_CR', // a photo or video in the chat (its picture loads only on screen)
    sticker: 'div.p8r1z > img', // a sticker: a picture on its own in a bubble
  };
  // Your name's colour in a group's header (red; others are blue), for when
  // "ME" is in another language.
  const ME_COLOR = 'rgb(242, 60, 87)';

  const clean = (s) => String(s || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  const chatId = () => (location.pathname.match(/^\/web\/([0-9a-f-]{36})/i) || [])[1] || null;
  // The open chat's list: by its class, or the list whose items hold groups
  // with a header and an exact time.
  const findList = () => document.querySelector(SEL.list)
    || [...document.querySelectorAll('ul')].find((u) => u.querySelector(':scope > li ul > li > header time[datetime]'));
  const hash = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h.toString(16); };
  // A bubble's own words: not those of the message it quotes. textContent, not
  // innerText: Snapchat hides the words (visibility: hidden, its privacy
  // screen), and innerText is empty for what's hidden.
  const words = (el) => clean([...el.querySelectorAll(SEL.text)].filter((s) => !s.closest(SEL.reply)).map((s) => s.textContent).join('\n'));

  // What the open chat shows now. Only a group's first message says when it
  // was sent; the others in the group were sent between then and the next
  // group (`from`, `to`; no `to` for the last group: until it was read), and
  // are placed a millisecond apart after it.
  function read() {
    const id = chatId();
    const list = id && findList();
    if (!list) return null;
    const groups = [...list.querySelectorAll(SEL.group)];
    const timeOf = (g) => Date.parse(g.querySelector(`${SEL.message} > header ${SEL.when}`)?.getAttribute('datetime') || '');
    const starts = groups.map(timeOf);
    const items = [];
    groups.forEach((g, gi) => {
      const at = starts[gi];
      const head = g.querySelector(`${SEL.message} > header`);
      if (!Number.isFinite(at) || !head) return; // not a group of messages this knows
      const name = clean(head.querySelector(SEL.who)?.textContent);
      const me = /^me$/i.test(name) || getComputedStyle(head).color === ME_COLOR;
      const next = starts.slice(gi + 1).find(Number.isFinite);
      const to = Number.isFinite(next) ? next : null;
      [...g.querySelectorAll(SEL.message)].forEach((li, k) => {
        const b = li.querySelector(SEL.bubble);
        if (!b) return;
        const text = words(b);
        // A photo or video in the chat: its picture, once the owner has it on
        // screen, is a blob: (or data:) the page already holds — read it
        // locally and keep it (`url`, resolved to saved bytes before sending).
        // Stickers (served from Snapchat's CDN, cross-origin) stay notes.
        const media = [...b.querySelectorAll(SEL.media)].map((box) => {
          const el = box.querySelector('video') || box.querySelector('img');
          const src = el && (el.currentSrc || el.getAttribute('src') || '');
          const local = src && (src.startsWith('blob:') || src.startsWith('data:'));
          return { kind: box.querySelector('video') ? 'video' : 'image', ...(local ? { url: src } : {}) };
        }).concat([...b.querySelectorAll(SEL.sticker)].map(() => ({ kind: 'image', sticker: true })));
        // Anything else (a Snap, a notice, a sticker this doesn't know) is left alone.
        if (!text && !media.length) return;
        const q = b.querySelector(SEL.reply);
        const reply = q ? { sender: clean(q.querySelector(SEL.replyWho)?.textContent), text: clean([...q.querySelectorAll(SEL.text)].map((s) => s.textContent).join(' ')).slice(0, 200) } : null;
        items.push({
          key: `${at}|${me ? 'me' : hash(name)}|${k}|${hash(text)}|${media.length}`,
          at: at + k, from: at, to, me, sender: me ? '' : name, text, media, ...(reply ? { reply } : {}),
        });
      });
    });
    const people = [...new Set(items.filter((i) => !i.me && i.sender).map((i) => i.sender))];
    const title = clean(document.querySelector(SEL.title)?.textContent) || people.join(', ');
    return { chat: { id, title, people, group: people.length > 1 }, items };
  }

  // Sends the whole open chat when it's changed, at most every few seconds
  // while the page changes, so a chat being read or arriving isn't sent line
  // by line. The whole of it, with when the page loaded (`visit`): a message's
  // key changes when older messages load above its group and join it, and
  // the extension replaces what this visit sent before by the newest read
  // (GMLib.keepWebRead), so nothing is kept twice.
  const visit = Date.now();
  const sent = new Map(); // chat id -> what was last sent (its hash)
  const mediaHash = new Map(); // a rendered blob/data URL -> its stored content hash
  const mediaKept = new Set(); // content hashes already sent to the extension
  let timer = null;
  let sending = false;
  let settled = ''; // the chat open at the last read, and its oldest message
  function soon() {
    if (timer || sending) return;
    timer = setTimeout(() => { timer = null; send(); }, 2500);
  }
  const ask = (msg) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? null : r)); } catch { resolve(null); }
  });
  const sha = async (buf) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  const MAX_MEDIA = 20 * 1024 * 1024;
  // Saves the photos/videos the open chat shows: each `media.url` (a blob the
  // page already holds) is read locally, kept by the extension under its
  // content hash, and the item carries the hash instead of the URL. A few per
  // pass so a long chat doesn't read hundreds of files at once; the rest come
  // on the next pass. Returns false if any were left for next time.
  async function saveMedia(items, chatId) {
    let budget = 8;
    let more = false;
    for (const it of items) for (const md of it.media || []) {
      if (!md.url) continue;
      const url = md.url;
      delete md.url;
      const known = mediaHash.get(url);
      if (known) { md.hash = known; continue; }
      if (budget <= 0) { more = true; continue; }
      budget--;
      try {
        const blob = await fetch(url).then((r) => r.blob());
        if (!blob.size || blob.size > MAX_MEDIA) continue;
        const buf = await blob.arrayBuffer();
        const h = await sha(buf);
        if (!mediaKept.has(h)) {
          const r = await ask({ type: 'gm-web-media', service: 'snapchat', chatId, hash: h, kind: md.kind, mime: blob.type || '', b64: b64(buf) });
          if (!r?.ok) continue; // left as a note; tried again next pass
          mediaKept.add(h);
        }
        mediaHash.set(url, h);
        md.hash = h;
      } catch { /* not readable now: stays a note, tried again next pass */ }
    }
    return more;
  }
  async function send() {
    if (sending) return;
    if (!alive()) { watch.disconnect(); return; }
    let got;
    try { got = read(); } catch { return; } // the page changed under it: next time
    if (!got || !got.items.length) { settled = ''; return; }
    // Sent once it holds still: the same chat, title and oldest message on
    // two reads in a row. A chat just opened or switched to (the address can
    // change before the messages shown do), or still loading older messages,
    // is read again shortly instead.
    const open = `${got.chat.id}\n${got.chat.title}\n${got.items[0].key}`;
    if (open !== settled) { settled = open; soon(); return; }
    sending = true;
    try {
      const more = await saveMedia(got.items, got.chat.id);
      const sum = hash(JSON.stringify(got));
      if (sent.get(got.chat.id) !== sum) {
        const r = await ask({ type: 'gm-web-capture', service: 'snapchat', visit, chat: got.chat, items: got.items });
        if (r?.ok) sent.set(got.chat.id, sum);
      }
      if (more) soon(); // keep reading the rest of this chat's photos in
    } finally { sending = false; }
  }
  const watch = new MutationObserver(soon);
  watch.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  soon();
})();
