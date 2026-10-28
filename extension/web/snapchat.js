// Message Archivist on Snapchat for Web (www.snapchat.com/web): keeps the
// chats you open there, as you read them, for your archive. Snapchat's own
// download has only saved messages; this fills in the rest while they're
// still on screen. Registered for these pages only when it's turned on in
// Settings → Apps → Snapchat (Chrome asks to let it read snapchat.com).
//
// It only reads the page's HTML. It never clicks, types, scrolls or changes
// anything on the page, never opens a Snap, never saves a message in
// Snapchat, and never takes a screenshot or captures the screen: nothing
// about how Snapchat works for you changes, and nobody is notified of
// anything. Snaps (the photos and videos you tap to view, gone once seen)
// aren't chat messages, so they aren't read at all: only messages, replies,
// and the chat's photos and videos (as "a photo was here") are. What it
// reads goes to the extension (background `gm-web-capture`), which keeps it
// until Settings puts it in the archive. It logs nothing.
(() => {
  if (window.__maSnapchat) return;
  window.__maSnapchat = true;

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
        const media = [...b.querySelectorAll(SEL.media)].map((m) => ({ kind: m.querySelector('video') ? 'video' : 'image' }))
          .concat([...b.querySelectorAll(SEL.sticker)].map(() => ({ kind: 'image', sticker: true })));
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

  // Sends what's new since the last time (per chat), at most every few seconds
  // while the page changes, so a chat being read or arriving isn't sent line by line.
  const sent = new Map(); // chat id -> item key -> its JSON
  let timer = null;
  let settled = ''; // the chat open at the last read: one is sent from its second read on
  function soon() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; send(); }, 2500);
  }
  function send() {
    let got;
    try { got = read(); } catch { return; } // the page changed under it: next time
    if (!got || !got.items.length) { settled = ''; return; }
    // A chat just opened, or switched to: read it again shortly, in case the
    // address changed before the messages shown did.
    const open = `${got.chat.id}\n${got.chat.title}`;
    if (open !== settled) { settled = open; soon(); return; }
    const seen = sent.get(got.chat.id) || new Map();
    const fresh = got.items.filter((it) => seen.get(it.key) !== JSON.stringify(it));
    if (!fresh.length) return;
    try {
      chrome.runtime.sendMessage({ type: 'gm-web-capture', service: 'snapchat', chat: got.chat, items: fresh }, (r) => {
        if (chrome.runtime.lastError || !r?.ok) return; // tried again when the page next changes
        for (const it of fresh) seen.set(it.key, JSON.stringify(it));
        sent.set(got.chat.id, seen);
      });
    } catch { /* the extension was reloaded: this copy stops */ }
  }
  new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  soon();
})();
