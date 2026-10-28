// Shared by the content script on the Messages tab and the settings page:
// merging newly read messages into a saved chat, the files that make up the
// backup library's index, and the checks that say whether a chat's backup is
// complete. Plain functions only, with no page or extension APIs.
//
// The library is one folder: the archive of every conversation, whichever
// app it came from (see SERVICES). data.js lists every chat with a short
// summary; each chat keeps its messages in conversations/[<App>/]<chat>/
// messages.json, plus a chat.js the viewer reads and its own messages.csv. A
// backup only rewrites the files of the chats it changed.
globalThis.GMLib = globalThis.GMLib || (() => {
  const INDEX_VERSION = 5;

  // ---------- the apps a conversation can come from: modules ----------
  // Every chat in the library belongs to one source (service). Google
  // Messages is the core: its texts (SMS, MMS and RCS, from Google Messages
  // for Web and the Android app's phone backups) are "sms", the default, so
  // libraries from before services read as they are. Every other app is a
  // module: one file in modules/ that adds itself here (addModule) wherever
  // the archive is read or written (Settings, the viewer, the Messages
  // page's content script, the backup folder's index.html), its chats in
  // conversations/<folder>/<chat>/. Texts from elsewhere stay apart: iMessage
  // (with an iPhone's SMS) is a module of its own. A module is
  //   { id, label, short, color, folder, ids, book?, partial?, steps, phone?, later?, reader? }
  // id: the `service` its chats carry. label, short, color: how it shows.
  // ids: what identifies a person there, which is how the viewer finds the
  // same person in several apps. book: its names are the phone's contacts'
  // (People may tie a chat to a contact by a name). partial: what its export
  // always leaves out. steps: how to get its export, in Settings' Apps tab.
  // phone: what the Android app takes ('share': an export shared to it from
  // the app; 'download': a file downloaded on the phone). later: why it can't
  // come in yet. reader: { detect, open, explain? }, read by import.js
  // (GMImport, Settings only), which may serve two modules (Meta's).
  const SERVICES = {}; // id -> how the module shows and files its chats: { label, short, folder, color, ids, book? }
  const MODULES = new Map();
  function addModule(m) {
    if (!m?.id || !m.label) throw new Error('A module needs an id and a label.');
    MODULES.set(m.id, m);
    SERVICES[m.id] = { label: m.label, short: m.short || m.label.slice(0, 2).toUpperCase(), folder: 'folder' in m ? m.folder : m.label, color: m.color || '#888888', ids: m.ids || 'name', ...(m.book ? { book: true } : {}) };
    return m;
  }
  const modules = () => [...MODULES.values()];
  const moduleOf = (id) => MODULES.get(id) || null;
  // The core: what this extension backs up from Google Messages for Web, and
  // the Android app from the phone itself.
  addModule({
    id: 'sms', core: true, label: 'Google Messages', short: 'GM', folder: null, color: '#1a73e8', ids: 'phone', book: true,
    steps: [
      'Back up from Google Messages for Web with this extension: open messages.google.com, then a chat, and click the toolbar button (or Back up everything).',
      'Or back up the phone itself with the Message Archivist Android app, and bring its .tar in here.',
    ],
  });
  const serviceOf = (x) => (x && (x.service || x.svc)) || 'sms';
  const serviceLabel = (id) => SERVICES[id]?.label || id;
  // The folder an app's chats go in ("Google Messages" for a second account's texts).
  const appFolder = (service) => SERVICES[service]?.folder || SERVICES[service]?.label || service;

  // ---------- accounts: which of your numbers or IDs within an app ----------
  // Two phones, a work number, another Apple ID or Telegram account: each is
  // an account, and a chat only ever joins chats of the same app *and*
  // account. A chat is in its app's main account unless it says otherwise
  // (`account`, `account_label` in messages.json and its index row), so every
  // library from before accounts reads as it is. accounts.json, beside data.js,
  // remembers which ID is each app's main account once an import has said
  // (Settings, `resolveAccounts`).
  // Numbers compare by their last ten digits; anything else by its lower case.
  const accountKey = (id) => { const t = String(id ?? '').trim(); return !t ? '' : NUMBER_TITLE.test(t) ? `tel:${phoneKey(t)}` : `id:${t.toLowerCase()}`; };
  const accountOf = (x) => (x && x.account) || null;
  const sameAccount = (a, b) => accountKey(a) === accountKey(b);
  // How an account shows: a number formatted, anything else as it is.
  const accountLabel = (id, label) => label || (NUMBER_TITLE.test(String(id || '').trim()) ? formatNumber(String(id)) : String(id || ''));
  const reserved = (name) => Object.values(SERVICES).some((v) => v.folder && v.folder.toLowerCase() === name.toLowerCase());
  // Where a new chat's folder goes: text messages straight in conversations/
  // (as always), every other app in its own folder there. A text chat named
  // like an app's folder gets " (chat)" so the two never share a folder.
  function chatFolder(service, title, account = null) {
    const name = safeName(title);
    // A second account's chats: conversations/<App> - <account>/<chat>.
    if (account?.id) return `conversations/${safeName(`${appFolder(service)} - ${accountLabel(account.id, account.label)}`)}/${name}`;
    const folder = SERVICES[service]?.folder;
    if (!folder) return `conversations/${reserved(name) ? `${name} (chat)` : name}`;
    return `conversations/${folder}/${name}`;
  }

  // ---------- people: one person across apps, accounts and numbers ----------
  // The same someone texts you, writes on WhatsApp and has an Instagram
  // account, and may have had two numbers. A person is a set of one-to-one
  // chats. Chats that share a number (in any app), an email address, or a
  // handle in one app (a Telegram user ID, a Discord, TikTok or Snapchat
  // username) are the same person by themselves. A name in common isn't enough: names are
  // whatever you or they typed, so same-named people are only suggested.
  // people.json (and people.js, for index.html opened from disk) keeps what
  // the owner decided, by chat (chatKey), and is written by the viewer:
  //   joined [[a, b]]  the same person
  //   apart  [[a, b]]  not the same person (stops the suggestion)
  //   alone  [a]       split off from the chats it shares a number with
  //   names  { a: n }  the person's name, kept on one of their chats
  const PEOPLE_VERSION = 1;
  const chatKey = (row) => row.id || row.folder;
  const othersIn = (row) => (row.contact?.people || []).filter((p) => (p.n ?? p.name) !== 'Me');
  const isGroupChat = (row) => row.group === true || othersIn(row).length > 1;
  // A chat with one other person: by its contact card, or for texts with no
  // card, by its name. Channels and "Saved Messages" have no one else in them.
  const isPersonChat = (row) => !isGroupChat(row) && (othersIn(row).length === 1 || (!othersIn(row).length && serviceOf(row) === 'sms' && (row.participants || []).filter((p) => p !== 'Me').length <= 1));
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // What says who someone is: their number (last ten digits), email address,
  // or handle in an app; and, from a phone backup, the phone's contact
  // (`card`): its other numbers and emails, and the contact itself, so their
  // chats from every number they've had join up.
  function idsOf(p, service) {
    const ids = [];
    const tel = (s) => { const d = String(s ?? '').replace(/\D/g, ''); if (d.length >= 7) ids.push(`tel:${d.slice(-10)}`); };
    const name = String(p.n ?? p.name ?? '').trim();
    const h = String(p.h ?? p.handle ?? '').trim().toLowerCase();
    tel(p.num ?? p.number);
    if (EMAIL.test(name)) ids.push(`email:${name.toLowerCase()}`);
    else if (NUMBER_TITLE.test(name)) tel(name);
    if (h) ids.push(EMAIL.test(h) ? `email:${h}` : `${service}:${h}`);
    for (const n of p.card?.numbers || []) tel(n);
    for (const e of p.card?.emails || []) if (EMAIL.test(e)) ids.push(`email:${String(e).toLowerCase()}`);
    if (p.card?.key) ids.push(`contact:${p.card.key}`);
    return ids;
  }
  // A one-to-one chat's person: from its contact card, else from its name
  // when that's a number, short code or email address.
  function personIds(row) {
    const ids = new Set(othersIn(row).flatMap((p) => idsOf(p, serviceOf(row))));
    if (!ids.size && row.title) {
      for (const id of idsOf({ n: row.title }, serviceOf(row))) ids.add(id);
      const d = String(row.title).replace(/\D/g, '');
      if (!ids.size && NUMBER_TITLE.test(row.title) && d.length >= 3) ids.add(`tel:${d}`); // a short code
    }
    return [...ids];
  }
  // The name a chat knows its person by: not a number, and not an importer's
  // stand-in ("TikTok chat 3").
  const STAND_IN = /^(unknown|conversation|.+ (chat|channel) \d+)$/i;
  function personName(row) {
    const o = othersIn(row);
    const n = String((o.length === 1 && (o[0].n ?? o[0].name)) || row.title || '').trim();
    return n && !isNumberName(n) && !EMAIL.test(n) && !STAND_IN.test(n) ? n : null;
  }
  // Names compare without case, accents or punctuation.
  const nameKey = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  // Names from the phone's contacts (yours) beat names people gave themselves:
  // the apps whose module says its names are the phone's (`book`).
  const fromBook = (service) => !!SERVICES[service]?.book;
  const pairKey = (a, b) => [a, b].sort().join('\n');

  // The phone's address book (contacts.json, from a phone backup with "Save
  // all my contacts" on): each contact by what ties a chat to them. A number
  // or email address that's on two contacts ties to neither; so does a name.
  function contactIndex(book) {
    const by = new Map();
    const add = (k, c) => { if (!k) return; by.set(k, by.has(k) && by.get(k) !== c ? null : c); };
    for (const c of book?.contacts || []) {
      if (!c?.key) continue;
      for (const id of [...(c.numbers || []).flatMap((n) => idsOf({ num: n }, 'sms')), ...(c.emails || []).map((e) => `email:${String(e).toLowerCase()}`)]) add(id, c);
      const n = nameKey(c.name);
      if (n.length > 1) add(`name:${n}`, c);
    }
    // A chat's contact: by its ids, or, in an app whose names come from the
    // phone's contacts (fromBook), by a name only one contact has.
    return (ids, service, name) => {
      const hits = new Set(ids.map((id) => by.get(id)).filter(Boolean));
      if (!hits.size && fromBook(service) && name) { const c = by.get(`name:${nameKey(name)}`); if (c) hits.add(c); }
      return hits.size === 1 ? [...hits][0] : null;
    };
  }
  // What ties someone to a contact, as ids: the contact itself, and its
  // numbers and email addresses (for the groups they're in).
  const contactIds = (c) => (c ? [`contact:${c.key}`, ...(c.numbers || []).flatMap((n) => idsOf({ num: n }, 'sms')), ...(c.emails || []).map((e) => `email:${String(e).toLowerCase()}`)] : []);

  // Everyone in the library: { list, byChat, suggestions, groupsOf }. Each
  // person is { key, name, named, chats (rows, most messages first), ids,
  // names, services, count, first, last, contact }; `key` is their first
  // chat's key, `contact` their entry in the phone's address book (`book`,
  // contacts.json), which joins their chats from every app and names them.
  // Suggestions are pairs of people with a name in common ({ a, b, name }).
  function people(rows, saved = null, book = null) {
    const S = { joined: [], apart: [], alone: [], names: {}, ...(saved || {}) };
    const alone = new Set(S.alone);
    const solo = rows.filter(isPersonChat);
    const contactOf = contactIndex(book);
    const chatContact = new Map(solo.map((r) => [chatKey(r), contactOf(personIds(r), serviceOf(r), personName(r))]));
    const idsOfChat = (r) => [...new Set([...personIds(r), ...contactIds(chatContact.get(chatKey(r)))])];
    const up = new Map(solo.map((r) => [chatKey(r), chatKey(r)]));
    const find = (k) => { while (up.get(k) !== k) { up.set(k, up.get(up.get(k))); k = up.get(k); } return k; };
    const join = (a, b) => { if (up.has(a) && up.has(b)) up.set(find(b), find(a)); };
    const seen = new Map();
    for (const r of solo) {
      if (alone.has(chatKey(r))) continue;
      for (const id of idsOfChat(r)) { if (seen.has(id)) join(seen.get(id), chatKey(r)); else seen.set(id, chatKey(r)); }
    }
    for (const [a, b] of S.joined) join(a, b);
    const groups = new Map();
    for (const r of solo) { const k = find(chatKey(r)); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const count = (r) => r.count ?? r.messages?.length ?? 0;
    const list = [...groups.values()].map((chats) => {
      chats.sort((a, b) => count(b) - count(a));
      const names = [...new Set(chats.map(personName).filter(Boolean))];
      const own = chats.map((r) => S.names[chatKey(r)]).find(Boolean);
      const book = chats.find((r) => fromBook(serviceOf(r)) && personName(r)) || chats.find(personName);
      const contact = chats.map((r) => chatContact.get(chatKey(r))).find(Boolean) || null;
      const ends = (f, pick) => chats.map((r) => r[f]).filter(Boolean).reduce((x, y) => (x == null || pick(y, x) ? y : x), null);
      return {
        key: chats.map(chatKey).sort()[0],
        name: own || contact?.name || (book ? personName(book) : formatNumber(chats[0].title || '')) || '?',
        named: !!own,
        chats,
        ids: [...new Set(chats.flatMap(idsOfChat))],
        names,
        services: [...new Set(chats.map(serviceOf))],
        count: chats.reduce((t, r) => t + count(r), 0),
        first: ends('first', (y, x) => y < x),
        last: ends('last', (y, x) => y > x),
        contact,
      };
    });
    const byChat = new Map(list.flatMap((p) => p.chats.map((r) => [chatKey(r), p])));

    const apart = new Set(S.apart.map(([a, b]) => pairKey(a, b)));
    const isApart = (p, q) => p.chats.some((a) => q.chats.some((b) => apart.has(pairKey(chatKey(a), chatKey(b)))));
    const byName = new Map();
    for (const p of list) {
      for (const n of new Set([p.name, ...p.names].map(nameKey).filter((k) => k.length > 1))) {
        if (!byName.has(n)) byName.set(n, []);
        byName.get(n).push(p);
      }
    }
    const suggestions = [];
    const asked = new Set();
    for (const [name, ps] of byName) {
      if (ps.length < 2 || ps.length > 4) continue; // "Mom" in four apps is likely; in forty, not
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const k = pairKey(ps[i].key, ps[j].key);
          if (asked.has(k) || isApart(ps[i], ps[j])) continue;
          asked.add(k);
          suggestions.push({ a: ps[i], b: ps[j], name });
        }
      }
    }

    // The group chats someone is in: by number, email or handle, or, for a
    // member the group knows only by name, by name in a group from the same
    // app. A member with a number is that number's person only: matching
    // their name too would put everyone else with that name in the group.
    const inGroups = new Map();
    for (const r of rows.filter(isGroupChat)) {
      for (const p of othersIn(r)) {
        const keys = idsOf(p, serviceOf(r));
        const n = nameKey(p.n ?? p.name);
        // Known only by name: their contact, when only one has that name.
        if (n && !keys.length) keys.push(`name:${serviceOf(r)}|${n}`, ...contactIds(contactOf([], serviceOf(r), p.n ?? p.name)).slice(0, 1));
        for (const k of keys) { if (!inGroups.has(k)) inGroups.set(k, new Set()); inGroups.get(k).add(r); }
      }
    }
    const groupsOf = (p) => {
      const keys = [...p.ids, ...p.chats.filter(personName).map((r) => `name:${serviceOf(r)}|${nameKey(personName(r))}`)];
      return [...new Set(keys.flatMap((k) => [...(inGroups.get(k) || [])]))].sort((a, b) => count(b) - count(a));
    };
    return { list, byChat, suggestions, groupsOf };
  }

  // ---------- codes, promotions and automated texts ----------
  // What clutters an archive: one-time codes ("123456 is your verification
  // code"), promotions and spam ("Reply STOP to opt out", or a link from a
  // number you don't know), and other automated texts (alerts, deliveries and
  // reminders from short codes and business names). Told apart per chat, from
  // who it's with (senderOf) and what its messages look like (chatTraits),
  // never in a group or a chat you've talked in. The viewer keeps them out of
  // All chats (its Codes, Promotions and Automated folders); Settings can
  // leave them out of the archive altogether (skipCodes, skipPromos,
  // skipAutomated).
  const CHAT_KINDS = { codes: 'Verification codes', promos: 'Promotions and spam', automated: 'Other automated texts' };
  // The rules' version, kept in each chat's traits (`v`): where an index row's
  // traits are used (leaving chats out), a row counted by older rules is counted
  // again from its chat. Raise it whenever a rule below changes.
  const TRAITS_VERSION = 2;
  const CODE_WORD = /\b(?:codes?|otp|one[- ]?time|pass ?code|pin|2fa|two[- ](?:factor|step)|verif(?:y|ying|ication)|authenticat\w*|log ?in|sign ?in|c[oó]digo|codice|kode?|bestätigungscode)\b|do(?:n['’]?t| not) share|never share/i;
  const CODE_DIGITS = /(?:^|[^\w])(?:[A-Z]{1,3}-)?(?:\d{4,8}|\d{3}[- ]\d{3})(?!\w)/;
  // The lines marketing texts carry, in any capitals: "Reply STOP", "STOP=end",
  // "STOP2END", "STOP to quit", "End=STOP", "HELP4help", "Msg&data rates may
  // apply", "Msg frequency varies", "4 msgs/mo". PROMO_CAPS: "Reply END" and
  // the like only in capitals, so "I'll text end of day" isn't one.
  const PROMO = /\b(?:reply|rply|text|txt|send|respond)\s+(?:back\s+|with\s+)?["“'(\[]?(?:st[o0]p\w*|unsub\w*|opt[- ]?out)\b|\bst[o0]p\s*(?:=|:|-+>?|→|>|2|to|4)\s*(?:end|quit|stop|cancel|opt[- ]?out|unsub\w*)\b|\b(?:end|quit|cancel|opt[- ]?out|unsub\w*)\s*=\s*st[o0]p\b|\bstop\s+receiving\b|\bopt[- ]?out\b|\bunsub(?:scribe)?\b|\bhelp\s*(?:=|:|4|for)\s*(?:help|info)\b|\breply\s+["“']?help\b|\b(?:msg|message)s?\s*(?:&|and|\+)\s*data\b|\brates\s+may\s+apply\b|\b(?:msg|message)\s*freq|\b\d+\s*(?:msgs?|messages)\s*(?:\/|per\s+)(?:mo|mth|month|wk|week|day)\b/i;
  const PROMO_CAPS = /\b(?:[Rr]e?ply|REPLY|RPLY|[Tt]e?xt|TE?XT|[Ss]end|SEND|[Rr]espond|RESPOND)\s+["“'(\[]?(?:END|QUIT|CANCEL|UNSUBSCRIBE|OPTOUT)\b/;
  const LINK = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|co|ly|me|io|info|link|xyz|top|click|app|us|biz|site|online|shop)\/\S/i;
  const SCAM = /\b(?:congrat\w*|winner|you(?:['’]ve| have)? won|prize|claim|gift ?card|reward|free|urgent|suspend\w*|locked|unusual activity|verify your|update your|package|parcel|deliver\w*|shipment|usps|fedex|dhl|toll|unpaid|overdue|refund|crypto|bitcoin|invest\w*|loan|pre-?approved|limited time|act now|click|sale|deals?|discount\w*|coupons?|promo\w*|offers?|shop now|order now|buy now|exclusive|bonus|cash ?back|earn\w*|hiring|part[- ]time|apply now|survey|donat\w*|chip in|\d{1,2}% off)\b/i;
  // What a chat's messages look like: how many you sent and how many came in,
  // and of those, how many are codes, promotions, links and links with
  // scam-like words. Takes messages.json records or chat.js's short form.
  function chatTraits(messages) {
    const t = { v: TRAITS_VERSION, sent: 0, received: 0, codes: 0, promos: 0, links: 0, scams: 0 };
    for (const m of messages || []) {
      if (m.direction ? m.direction === 'sent' : !!m.d) { t.sent++; continue; }
      if (m.kind === 'system') continue;
      t.received++;
      const x = String(m.text ?? m.x ?? '');
      if (!x) continue;
      if (x.length <= 400 && CODE_WORD.test(x) && CODE_DIGITS.test(x)) t.codes++;
      if (PROMO.test(x) || PROMO_CAPS.test(x)) t.promos++;
      if (LINK.test(x)) { t.links++; if (SCAM.test(x)) t.scams++; }
    }
    return t;
  }
  // Who a chat is with, for telling automated senders apart: 'group',
  // 'contact' (a name of yours), 'short' (a short code: 3 to 6 digits),
  // 'business' (a sender ID such as "AMAZON" or "VM-BANKX" instead of a
  // number) or 'number' (a number or address with no name saved).
  function senderOf(row) {
    if (isGroupChat(row)) return 'group';
    const p = othersIn(row)[0] || {};
    const name = String(p.n ?? p.name ?? row.title ?? '').trim();
    const num = String(p.num ?? p.number ?? '').trim();
    if (/[a-z]/i.test(num) && !EMAIL.test(num)) return 'business';
    if (!name || NUMBER_TITLE.test(name) || EMAIL.test(name)) {
      const d = (num || name).replace(/\D/g, '');
      return d.length >= 3 && d.length <= 6 ? 'short' : 'number';
    }
    // A text from "AMAZON" or "VM-HDFCBK" with no number behind it is a sender ID.
    if (!num && serviceOf(row) === 'sms' && /^(?=.*[A-Z]{3})[A-Z0-9][A-Z0-9-]{2,}$/.test(name)) return 'business';
    return 'contact';
  }
  // Which of CHAT_KINDS a chat is, if any. A contact needs more to go on (and
  // a reply from you makes it a conversation); three messages of yours make
  // any chat one.
  function chatKind(row, traits = row.traits) {
    if (!traits?.received) return null;
    const who = senderOf(row);
    if (who === 'group') return null;
    const { sent = 0, received, codes = 0, promos = 0, links = 0, scams = 0 } = traits;
    const contact = who === 'contact';
    if (sent >= 3 || (contact && sent)) return null;
    if (codes / received >= (contact ? 0.8 : 0.5) && (!contact || received >= 2)) return 'codes';
    if (promos / received >= (contact ? 0.5 : 0.2)) return 'promos';
    if (who === 'number' && scams && links / received >= 0.5 && received <= 20) return 'promos';
    if (who === 'short' || who === 'business') return 'automated';
    return null;
  }
  // With the owner's say (labels.json): a chat they kept ("It's not", `keep`)
  // or labelled with anything but Spam is none; one labelled Spam is
  // promotions and spam.
  function chatKindFor(row, labels, traits = row.traits) {
    const k = chatKey(row);
    const ids = labels?.chats?.[k] || [];
    if (labels?.keep?.[k] || ids.some((id) => id !== 'spam')) return null;
    if (ids.includes('spam')) return 'promos';
    return chatKind(row, traits);
  }
  // The kinds Settings leaves out of the archive.
  const skipKinds = (s) => new Set([s?.skipCodes && 'codes', s?.skipPromos && 'promos', s?.skipAutomated && 'automated'].filter(Boolean));
  // Whether traits were counted by the rules as they are now.
  const traitsCurrent = (t) => t?.v === TRAITS_VERSION;

  // The owner's decisions (people.json), changed: each returns a new object.
  const peopleSaved = (s) => ({ version: PEOPLE_VERSION, joined: [], apart: [], alone: [], names: {}, ...(s || {}) });
  const touched = (s) => ({ ...s, updated_at: new Date().toISOString() });
  // Two people are one. The name each was given stays only if the other had none.
  function joinPeople(saved, a, b) {
    const s = peopleSaved(saved);
    const all = new Set([...a.chats, ...b.chats].map(chatKey));
    const names = { ...s.names };
    if (a.named && b.named) for (const r of b.chats) delete names[chatKey(r)];
    return touched({
      ...s,
      names,
      joined: [...s.joined, [a.key, b.key]],
      apart: s.apart.filter(([x, y]) => !(all.has(x) && all.has(y))),
    });
  }
  // Not the same person: the suggestion goes away.
  function keepApart(saved, a, b) {
    const s = peopleSaved(saved);
    return touched({ ...s, apart: [...s.apart, [a.key, b.key]] });
  }
  // One chat isn't this person after all: it becomes someone of its own, and
  // the person's other chats stay together.
  function splitChat(saved, person, row) {
    const s = peopleSaved(saved);
    const k = chatKey(row);
    const rest = person.chats.map(chatKey).filter((x) => x !== k);
    const names = { ...s.names };
    if (person.named && names[k] && rest.length) { names[rest[0]] = names[k]; }
    delete names[k];
    return touched({
      ...s,
      names,
      alone: [...new Set([...s.alone, k])],
      joined: [...s.joined.filter(([x, y]) => x !== k && y !== k), ...rest.slice(1).map((x) => [rest[0], x])],
    });
  }
  // A name for the person (empty: back to the name their chats give).
  function renamePerson(saved, person, name) {
    const s = peopleSaved(saved);
    const names = { ...s.names };
    for (const r of person.chats) delete names[chatKey(r)];
    if (String(name || '').trim()) names[person.key] = String(name).trim();
    return touched({ ...s, names });
  }

  // One message record from an importer, in the library's shape (the same
  // fields a backup from Google Messages writes). `at` is a Date or ms; times
  // become the local "YYYY-MM-DD HH:MM" with the exact time in timestamp_raw.
  function importedRecord({ id, at, sender, sent, text, media, reply_to, reactions, edited, sender_id, kind }) {
    const ms = at instanceof Date ? at.getTime() : at;
    const ok = Number.isFinite(ms);
    return {
      ...(id != null && id !== '' ? { id: String(id) } : {}),
      direction: sent ? 'sent' : 'received',
      // Your own messages are "Me" in every app, as in text chats; the name
      // the export used for you is kept beside it.
      sender: sent ? 'Me' : sender || 'Unknown',
      ...(sent && sender && sender !== 'Me' ? { sender_name: sender } : {}),
      ...(sender_id ? { sender_id: String(sender_id) } : {}),
      text: text || '',
      timestamp: ok ? localMinute(ms) : null,
      timestamp_precision: ok ? 'message' : 'unknown',
      timestamp_raw: ok ? new Date(ms).toISOString() : null,
      media: media || [],
      ...(reply_to ? { reply_to } : {}),
      ...(reactions?.length ? { reactions } : {}),
      ...(edited ? { edited: true } : {}),
      ...(kind && kind !== 'message' ? { kind } : {}),
    };
  }

  // ---------- settings ----------
  // One definition for every part: the content script, the background worker,
  // the popup and Settings. The defaults are what a first-time user should get:
  // everything needed to put the texts back on a phone later (photos at full
  // size, contact cards with numbers), in a window that stays out of the way.
  const SETTINGS_VERSION = 5;
  const SETTINGS_DEFAULTS = {
    folderName: '',
    includeMedia: true,
    fullSize: true,
    fullSizeEarly: true,
    backupWindow: 'corner', // 'corner' (small, in a corner), 'window' (own window), 'tab' (left where it is)
    compactCorner: 'bottom-right',
    notify: true,
    patience: 25,
    verifyRead: false,
    rawMarkup: false,
    phoneMedia: true,
    downloadsSubfolder: 'Google Messages Exports',
    caseNote: '',
    schedules: [],
    obsidian: false, // keep the Obsidian notes (obsidian.js) up to date after every backup and import
    // Leave these out of the archive (chatKind): verification codes, promotions and spam, other automated texts.
    skipCodes: false,
    skipPromos: false,
    skipAutomated: false,
    // How lists of chats and people start out sorted (the archive's Chats and People, the Backups tab):
    // 'auto' (each list's own: Recent, Most messages, Favorites then A–Z), 'recent', 'count' or 'name'.
    chatSort: 'auto',
  };
  // Settings saved by 4.x: the three "full size" switches become one, the two
  // window switches become one choice, and the popup's remembered checkboxes
  // become the settings themselves. Old choices that differ from the defaults
  // only carry over where they were clearly made on purpose.
  function normalizeSettings(raw) {
    const s = { ...(raw || {}) };
    if ((s.settingsVersion || 0) < SETTINGS_VERSION) {
      const p = s.popup || {};
      if (!('includeMedia' in s) && p.includeMedia === false) s.includeMedia = false;
      if (!('fullSize' in s) && p.fullSize === false) s.fullSize = false;
      if (!('backupWindow' in s) && s.ownWindow === false) s.backupWindow = 'tab';
      for (const k of ['popup', 'ownWindow', 'compactWindow', 'totalFullSize', 'scheduleFullSize', 'saveMode']) delete s[k];
      if (Array.isArray(s.schedules)) s.schedules = s.schedules.map(({ action, ...j }) => j);
      s.settingsVersion = SETTINGS_VERSION;
    }
    return { ...SETTINGS_DEFAULTS, ...s, schedules: Array.isArray(s.schedules) ? s.schedules : [] };
  }

  // ---------- merging ----------

  // A message is identified by Google's message ID, or by time + sender + text.
  const sigOf = (m) => `${m.timestamp}|${m.sender}|${m.text}|${(m.media || []).length + (m.gif_previews_skipped || m.previews_skipped || 0) + (m.duplicates_removed || 0)}`;
  const keyOf = (m) => m.id || sigOf(m);

  function unknownIn(saved, scraped) {
    const ids = new Set(saved.map((m) => m.id).filter(Boolean));
    const sigs = new Set(saved.map(sigOf));
    const left = scraped.filter((m) => !(m.id && ids.has(m.id)) && !sigs.has(sigOf(m)));
    // Messages read from an app's web page carry the span they were sent in
    // (`web_window`, [from, to] ms: there, only a group's first message shows
    // its time). Between those and the app's own export, two messages are the
    // same when they're from the same side with the same words (or are both
    // only a photo) and one's time is in the other's span, give or take a
    // minute; each stands in for one other only.
    if (!left.length || !(left.some((m) => m.web_window) || saved.some((m) => m.web_window))) return left;
    const keyed = (m) => `${m.direction}|${normText(m.text) || ((m.media || []).length ? '\u0000photo' : '')}`;
    const pool = new Map();
    for (const s of saved) { const k = keyed(s); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(s); }
    const ms = (m) => Date.parse(m.timestamp_raw || '');
    const within = (m, w) => !!w && Number.isFinite(ms(m)) && ms(m) >= w[0] - 60e3 && ms(m) <= w[1] + 60e3;
    return left.filter((m) => {
      const list = pool.get(keyed(m)) || [];
      const i = list.findIndex((s) => within(s, m.web_window) || within(m, s.web_window));
      if (i < 0) return true;
      list.splice(i, 1);
      return false;
    });
  }

  // Merges new records into the saved ones by time. Equal times keep their
  // on-screen order; undated messages stay next to the message before them.
  function mergeChrono(saved, added, scraped = []) {
    const pos = new Map();
    scraped.forEach((m, i) => { if (m.id) pos.set(`id:${m.id}`, i); if (!pos.has(`sig:${sigOf(m)}`)) pos.set(`sig:${sigOf(m)}`, i); });
    const at = (r) => (r.id && pos.get(`id:${r.id}`)) ?? pos.get(`sig:${sigOf(r)}`);
    const items = [];
    for (const [src, list] of [[0, saved], [1, added]]) {
      let t = '';
      list.forEach((r, i) => { t = r.timestamp || t; items.push({ r, t, src, i, at: at(r) }); });
    }
    items.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1
      : a.src === b.src ? a.i - b.i
      : a.at != null && b.at != null ? a.at - b.at : a.src - b.src));
    return items.map((x, k) => ({ ...x.r, index: k + 1 }));
  }

  // ---------- the same picture twice ----------
  // A message can hold the same picture more than once: a GIF and its still
  // preview, or a small thumbnail next to the full-size photo. A tiny
  // fingerprint of what each picture looks like (a 64-point brightness
  // pattern, the same at any size) tells them apart from different photos.

  async function imageFingerprint(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const w = bmp.width;
      const h = bmp.height;
      const c = new OffscreenCanvas(9, 8);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0, 9, 8);
      bmp.close?.();
      const d = g.getImageData(0, 0, 9, 8).data;
      const lum = (i) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      let bits = '';
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += lum((y * 9 + x) * 4) > lum((y * 9 + x + 1) * 4) ? '1' : '0';
      return { bits, w, h };
    } catch {
      return null; // a format the browser can't draw (HEIC, say)
    }
  }

  // Same picture: nearly the same pattern and the same shape.
  function sameImage(a, b) {
    if (!a || !b) return false;
    let diff = 0;
    for (let i = 0; i < 64; i++) if (a.bits[i] !== b.bits[i]) diff++;
    const shape = (a.w / a.h) / (b.w / b.h);
    return diff <= 6 && shape > 0.9 && shape < 1.11;
  }

  // Of two copies of a picture, the one to keep: an animated GIF over its
  // still frame, then the bigger picture, then the bigger file.
  function betterCopy(a, b) {
    if (a.gif !== b.gif) return a.gif ? a : b;
    const area = (x) => (x.w || 0) * (x.h || 0);
    if (area(a) !== area(b)) return area(a) > area(b) ? a : b;
    return (a.size || 0) >= (b.size || 0) ? a : b;
  }

  // ---------- every picture's status ----------
  // Each photo, GIF, video and voice note in a chat has one status, so a backup
  // can say exactly what it holds and what's left to do:
  //   full       saved from Messages' full-size viewer
  //   same       the chat's picture, which the viewer showed was already full size
  //   thumbnail  the chat's smaller picture; "Upgrade to full size" can replace it later
  //   original   saved as Messages has it (GIFs, videos, voice notes, link previews)
  //   waiting    not fetched yet (a speed run, or a backup that stopped)
  //   skipped    not saved by choice (a link preview's picture from another website)
  //   failed     couldn't be saved; "Retry failed photos" tries again
  //   left       left out as another copy of one that was saved (a GIF's still
  //              frame, or a thumbnail beside the full-size photo)
  const MEDIA_STATUS = {
    full: 'Full size', same: 'Full size (the chat picture was already full size)', thumbnail: 'Thumbnail',
    original: 'Saved as sent', waiting: 'Not fetched yet', skipped: 'Not saved (by choice)', failed: 'Couldn’t be saved', left: 'Left out (another copy kept)',
  };
  function mediaStatus(md) {
    const file = md.file ?? md.f;
    const source = md.source ?? md.src ?? '';
    const kind = md.kind ?? md.k;
    if (file) {
      if (source === 'full-size viewer') return 'full';
      if (/same size as the full-size viewer/.test(source)) return 'same';
      if (kind === 'image' && /chat thumbnail/.test(source)) return 'thumbnail';
      return 'original';
    }
    if (md.skipped || md.skip) return 'skipped';
    if (md.error || md.err) return 'failed';
    return 'waiting';
  }
  const LEFT_OUT_NOTE = { 'gif-preview': 'the still frame of a GIF that was saved', duplicate: 'a smaller copy of a picture that was saved' };

  // The chat's master list of media: every item, its status and file, and the
  // pictures left out as copies. Takes full records (messages.json).
  function mediaIndex(messages, folder) {
    const rows = [];
    for (const m of messages) {
      const base = { message_index: m.index, message_id: m.id || null, timestamp: m.timestamp || null, sender: m.sender };
      (m.media || []).forEach((md, i) => rows.push({
        ...base, item: i + 1, kind: md.kind, status: mediaStatus(md), file: md.file ? `${folder}/${md.file}` : null,
        width: md.width || null, height: md.height || null, bytes: md.bytes || null, sha256: md.sha256 || null, source: md.source || null,
        note: md.error || md.skipped || (md.upgraded_from ? `upgraded from a ${md.upgraded_from.width || '?'}×${md.upgraded_from.height || '?'} thumbnail on ${(md.upgraded_from.at || '').slice(0, 10)}` : null),
      }));
      const left = m.media_left_out || Array.from({ length: m.gif_previews_skipped || 0 }, () => ({ kind: 'image', reason: 'gif-preview' }));
      for (const lo of left) rows.push({ ...base, item: null, kind: lo.kind, status: 'left', file: null, width: lo.width || null, height: lo.height || null, bytes: null, sha256: null, source: null, note: LEFT_OUT_NOTE[lo.reason] || lo.reason || null });
    }
    return rows;
  }
  const mediaCounts = (statuses) => {
    const c = { full: 0, same: 0, thumbnail: 0, original: 0, waiting: 0, skipped: 0, failed: 0, left: 0 };
    for (const st of statuses) c[st] = (c[st] || 0) + 1;
    return c;
  };
  function mediaIndexCsv(title, rows) {
    const head = ['conversation', 'message_index', 'message_id', 'timestamp', 'sender', 'item', 'kind', 'status', 'status_text', 'file', 'width', 'height', 'bytes', 'sha256', 'source', 'note'];
    return BOM + [head.join(','), ...rows.map((r) => [title, r.message_index, r.message_id, r.timestamp, r.sender, r.item, r.kind, r.status, MEDIA_STATUS[r.status], r.file, r.width, r.height, r.bytes, r.sha256, r.source, r.note].map(csvCell).join(','))].join('\r\n') + '\r\n';
  }

  // ---------- per-chat files ----------

  // The viewer's compact form of a chat's messages, with media paths from the library root.
  function compactMessages(folder, messages) {
    return messages.map((m) => {
      const o = { i: m.index, d: m.direction === 'sent' ? 1 : 0, s: m.sender, t: m.timestamp, x: m.text };
      if (m.timestamp_precision && m.timestamp_precision !== 'message') o.p = m.timestamp_precision;
      if (m.timestamp_raw) o.tr = m.timestamp_raw;
      if (m.id) o.id = m.id;
      if (m.media?.length) {
        o.m = m.media.map((md) => ({
          k: md.kind,
          f: md.file ? `${folder}/${md.file}` : null,
          ...(md.width ? { w: md.width, h: md.height } : {}),
          ...(md.source ? { src: md.source } : {}),
          ...(md.sha256 ? { sha: md.sha256 } : {}),
          ...(md.skipped ? { err: md.skipped, skip: 1 } : md.error ? { err: md.error } : {}),
          st: mediaStatus(md),
        }));
      }
      if (m.media_left_out?.length) o.lo = m.media_left_out.map((x) => ({ k: x.kind, why: x.reason, ...(x.width ? { w: x.width, h: x.height } : {}) }));
      if (m.reply_to) o.r = { s: m.reply_to.sender, x: m.reply_to.text };
      if (m.reactions?.length) o.rc = m.reactions;
      return o;
    });
  }

  // Loaded by the viewer with a <script> tag, so it works straight from disk.
  const chatScript = (folder, compact) => `(window.GM_CHATS = window.GM_CHATS || {})[${JSON.stringify(folder)}] = ${JSON.stringify(compact)};\n`;

  function contactSummary(folder, contact) {
    if (!contact?.people) return null;
    return {
      e2ee: contact.end_to_end_encrypted ?? contact.e2ee ?? null,
      at: contact.captured_at || contact.at || null,
      people: contact.people.map((p) => p.n !== undefined ? p : ({ n: p.name, num: p.number, ...(p.handle ? { h: p.handle } : {}), photo: p.photo ? (p.photo.startsWith('data:') ? p.photo : `${folder}/${p.photo}`) : null, ...(p.favorite ? { fav: 1 } : {}), ...(p.card ? { card: p.card } : {}) })),
    };
  }

  const CSV_HEADER = ['conversation', 'index', 'message_id', 'timestamp', 'timestamp_precision', 'timestamp_raw', 'sender', 'direction', 'text', 'reply_to', 'media_files', 'media_sha256', 'status', 'reactions', 'edited', 'links'].join(',');
  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const BOM = '﻿'; // so Excel reads UTF-8 (emoji etc.)

  // One chat's messages.csv. Takes full records (messages.json) or the compact form.
  function chatCsv(title, folder, messages) {
    const lines = [CSV_HEADER];
    for (const raw of messages) {
      const m = raw.i !== undefined && raw.index === undefined
        ? { index: raw.i, id: raw.id, timestamp: raw.t, timestamp_precision: raw.p || 'message', timestamp_raw: raw.tr, sender: raw.s, direction: raw.d ? 'sent' : 'received', text: raw.x, reply_to: raw.r ? { sender: raw.r.s, text: raw.r.x } : null,
          media: (raw.m || []).map((x) => ({ kind: x.k, file: x.f ? x.f.slice(folder.length + 1) : null, sha256: x.sha })) }
        : raw;
      lines.push([title, m.index, m.id, m.timestamp, m.timestamp_precision, m.timestamp_raw, m.sender, m.direction, m.text,
        m.reply_to ? `${m.reply_to.sender}: ${m.reply_to.text}` : '',
        (m.media || []).map((md) => (md.file ? `${folder}/${md.file}` : `[${md.kind} missing]`)).join(' '),
        (m.media || []).map((md) => md.sha256 || '').filter(Boolean).join(' '),
        m.status || '', (m.reactions || []).join(' | '), m.edited ? 'yes' : '', (m.links || []).join(' ')].map(csvCell).join(','));
    }
    return BOM + lines.join('\r\n') + '\r\n';
  }

  // The whole library's messages.csv, joined from each chat's own file.
  function joinCsv(parts) {
    return BOM + CSV_HEADER + '\r\n' + parts.map((p) => p.replace(/^﻿?[^\r\n]*\r?\n/, '')).join('');
  }

  // ---------- completeness checks ----------
  // Run after every save of a chat and kept in its progress.json, so the
  // settings page and the viewer can say how sure we are that it's complete.

  // Works on full records and on the viewer's compact form alike.
  const norm = (m) => ({ id: m.id, t: m.timestamp !== undefined ? m.timestamp : m.t, left: (m.media_left_out || m.lo || []).length || m.gif_previews_skipped || 0,
    media: (m.media || m.m || []).map((md) => ({ file: md.file ?? md.f ?? null, skipped: !!(md.skipped || md.skip), error: md.error ?? md.err ?? null, status: md.st || mediaStatus(md) })) });

  function checkChat(messages, progress, contact) {
    const list = messages.map(norm);
    const items = [];
    const add = (id, level, label, detail) => items.push({ id, level, label, detail });
    const p = progress || {};
    const historyDone = !!(p.history_complete ?? p.complete);

    const s = p.start;
    if (historyDone) {
      add('start', 'ok', 'Reached the first message',
        s?.detail ? `${s.detail}${s.at ? ` (${s.at.slice(0, 10)})` : ''}` : s?.method === 'earlier run' ? 'Confirmed by an earlier backup' : 'Confirmed by an earlier backup');
    } else if (p.from_phone) {
      // From a phone backup (the Android app): every message the phone had.
      add('start', 'ok', 'Whole chat from the phone', `Every message the phone had${p.from_phone.at ? ` on ${p.from_phone.at.slice(0, 10)}` : ''} (${p.from_phone.file || 'a phone backup'}). A backup from Google Messages adds any it didn’t keep, and the contact card.`);
    } else if (p.imported) {
      // From another app's export: the chat as that export had it.
      const what = serviceLabel(p.imported.service);
      if (p.imported.partial) add('start', 'warn', `Partly from ${what}`, `${p.imported.partial} (${p.imported.file || 'an export'}${p.imported.at ? `, ${p.imported.at.slice(0, 10)}` : ''})`);
      else add('start', 'ok', `Whole chat from ${what}`, `Every message in ${what}'s export${p.imported.at ? ` of ${p.imported.at.slice(0, 10)}` : ''} (${p.imported.file || 'an export'}). Bring in a newer export to add what's new.`);
    } else if (p.imported_from) {
      add('start', 'bad', 'Not yet read from Messages', `Imported from “${p.imported_from}”. The next backup reads the whole chat again to make sure nothing older is missing.`);
    } else {
      add('start', 'bad', 'History not fully loaded', p.stopped_reason || 'The backup stopped before reaching the first message. Run it again to carry on.');
    }

    const nc = p.newest_check;
    if (!nc && p.from_phone && !historyDone) add('newest', 'ok', 'Newest messages saved', `Up to the phone backup${p.from_phone.at ? ` of ${p.from_phone.at.slice(0, 10)}` : ''}`);
    else if (!nc && p.imported && !historyDone) add('newest', 'ok', 'Newest messages saved', `Up to the export${p.imported.at ? ` of ${p.imported.at.slice(0, 10)}` : ''}`);
    else if (nc) add('newest', nc.all_saved ? 'ok' : 'bad', 'Newest messages saved', nc.all_saved ? `The ${nc.on_screen} newest messages on screen are all in the backup (${(nc.at || '').slice(0, 16).replace('T', ' ')})` : 'Some of the newest messages on screen are missing from the backup');
    else add('newest', 'warn', 'Newest messages not checked', 'The next backup checks this.');

    const ids = list.map((m) => m.id).filter(Boolean);
    const dupes = ids.length - new Set(ids).size;
    add('ids', dupes ? 'bad' : 'ok', dupes ? 'Duplicate messages' : 'No duplicates', dupes ? `${dupes} message IDs appear more than once` : `${list.length.toLocaleString()} messages, ${ids.length.toLocaleString()} with message IDs`);

    let back = 0;
    let last = '';
    for (const m of list) { if (m.t) { if (m.t.slice(0, 16) < last.slice(0, 16)) back++; last = m.t; } }
    const undated = list.filter((m) => !m.t).length;
    add('order', back ? 'warn' : 'ok', 'In time order', back ? `${back} messages are earlier than the one before them` : `Oldest to newest${undated ? `, ${undated} without a date` : ''}`);

    const media = list.flatMap((m) => m.media);
    const c = mediaCounts(media.map((x) => x.status));
    const pending = c.waiting;
    const failed = c.failed;
    const savedMedia = c.full + c.same + c.thumbnail + c.original;
    const n = (x) => x.toLocaleString();
    // Every item accounted for: its status, in plain words.
    const breakdown = [c.full + c.same && `${n(c.full + c.same)} full size`, c.thumbnail && `${n(c.thumbnail)} thumbnail${c.thumbnail === 1 ? '' : 's'} (can be upgraded)`, c.original && `${n(c.original)} saved as sent`,
      c.waiting && `${n(c.waiting)} not fetched yet`, c.failed && `${n(c.failed)} failed`, c.skipped && `${n(c.skipped)} not saved (link previews from other websites, or left out of an export)`,
      list.reduce((t, m) => t + m.left, 0) && `${n(list.reduce((t, m) => t + m.left, 0))} left out as copies`].filter(Boolean).join(', ');
    if (pending && p.speed_run) add('media', 'warn', 'Photos not fetched yet (speed run)', `${breakdown}. “Fetch photos” saves them later, going back in the chat only as far as it needs to.`);
    else if (pending) add('media', 'bad', 'Media still to fetch', breakdown);
    else if (failed) add('media', 'warn', 'Some media couldn’t be saved', `${breakdown}. “Retry failed photos” tries them again.`);
    else add('media', 'ok', 'All media accounted for', media.length ? breakdown : 'No media in this chat');

    if (contact?.people?.length) add('contact', 'ok', 'Contact card', contact.people.map((x) => x.name || x.n).join(', '));
    else if (p.imported) add('contact', 'ok', 'People', 'As named in the export');
    else add('contact', 'warn', 'Contact card', 'Not captured');

    const sr = p.second_read;
    if (sr) {
      add('second', sr.added ? 'warn' : 'ok', 'Second read',
        sr.added ? `Reading the chat again found ${sr.added} more messages; they’re saved now` : `Read again on ${(sr.at || '').slice(0, 10)}: all ${Number(sr.read).toLocaleString()} messages matched`);
    }

    const bad = items.filter((i) => i.level === 'bad');
    const warn = items.filter((i) => i.level === 'warn');
    // A speed run saves every message first and lists its photos to fetch later.
    // From the phone and not yet read from Messages: "From phone", unless something's wrong.
    // From another app's export: "Imported", unless something's wrong.
    const status = !historyDone ? (p.from_phone ? (bad.some((i) => i.id !== 'media') ? 'problem' : pending ? 'messages' : 'phone')
      : p.imported ? (bad.length ? 'problem' : 'imported') : 'incomplete')
      : pending ? (p.speed_run ? 'messages' : 'incomplete') : bad.length ? 'problem' : warn.length ? 'complete' : 'verified';
    return { status, checked_at: new Date().toISOString(), problems: [...bad, ...warn].map((i) => i.label), items };
  }

  const STATUS_LABEL = { verified: 'Verified complete', complete: 'Complete', phone: 'From phone', imported: 'Imported', messages: 'Messages saved, photos to fetch', incomplete: 'Unfinished', problem: 'Needs attention' };

  // Which chats are completely backed up, and (after "Back up everything")
  // which conversations in Messages aren't.
  function verificationOf(rows, state, version) {
    const count = (s) => rows.filter((r) => r.status === s).length;
    const summary = { checked_at: new Date().toISOString(), chats: rows.length, verified: count('verified'), complete: count('complete'), phone: count('phone'), imported: count('imported'), messages: count('messages'), incomplete: count('incomplete'), problem: count('problem') };
    const apps = {};
    for (const r of rows) apps[serviceOf(r)] = (apps[serviceOf(r)] || 0) + 1;
    summary.services = apps;
    let coverage = null;
    // Coverage compares Google Messages' own list with its chats in the main account only.
    if (state?.conversations?.length) {
      const byId = new Map(rows.filter((r) => r.id && serviceOf(r) === 'sms' && !accountOf(r)).map((r) => [r.id, r]));
      // Chats you deleted from the backup and chose not to back up again don't count.
      const skip = new Set((state.excluded || []).map((e) => e.id));
      const convs = state.conversations.filter((c) => !skip.has(c.id));
      const missing = convs.filter((c) => !byId.has(c.id));
      const unfinished = convs.filter((c) => ['incomplete', 'problem'].includes(byId.get(c.id)?.status));
      coverage = { scanned_at: state.scanned_at, in_messages: convs.length, backed_up: convs.length - missing.length - unfinished.length, not_backed_up: missing, unfinished: unfinished.map(({ id, title }) => ({ id, title })), ...(skip.size ? { left_out: state.excluded } : {}) };
      summary.coverage = { scanned_at: coverage.scanned_at, in_messages: coverage.in_messages, backed_up: coverage.backed_up, not_backed_up: missing.length, unfinished: unfinished.length };
    }
    return {
      summary,
      full: {
        ...summary,
        tool: 'Message Archivist', version,
        statuses: STATUS_LABEL,
        coverage,
        chats: rows.map((r) => ({ title: r.title, service: serviceOf(r), ...(r.account ? { account: r.account } : {}), id: r.id, folder: r.folder, status: r.status, problems: r.problems, messages: r.count, first: r.first, last: r.last,
          media_saved: r.media_saved, media_failed: r.media_failed, media_pending: r.media_pending, checked_at: r.checked_at, details: `${r.folder}/progress.json` })),
      },
    };
  }

  // ---------- the index (data.js) ----------

  // The summary row data.js keeps for a chat. `messages` may be full records or compact.
  function summarize({ id, title, folder, data, progress, compact }) {
    const msgs = data?.messages || compact?.messages || [];
    const list = msgs.map(norm);
    const dated = list.filter((m) => m.t);
    const media = list.flatMap((m) => m.media);
    const contact = data?.contact || compact?.contact || null;
    const checks = progress?.checks || checkChat(msgs, progress, contact);
    const service = serviceOf(data || compact);
    const account = accountOf(data || compact);
    return {
      id: id || data?.conversation_id || compact?.id || null,
      title: title || data?.conversation || compact?.title,
      ...(service !== 'sms' ? { service } : {}),
      ...(account ? { account, account_label: (data || compact).account_label || accountLabel(account) } : {}),
      folder,
      file: `${folder}/chat.js`,
      participants: data?.participants || compact?.participants || [...new Set(msgs.map((m) => m.sender ?? m.s))],
      updated_at: data?.updated_at || data?.exported_at || compact?.updated_at || null,
      range: data?.range || compact?.range || null,
      ...(contact ? { contact: contactSummary(folder, contact) } : {}),
      ...(data?.group ? { group: true } : {}),
      traits: chatTraits(msgs),
      ...(data?.conversation_details?.pinned || compact?.pinned ? { pinned: true } : {}),
      count: list.length,
      first: dated[0]?.t || null,
      last: dated[dated.length - 1]?.t || null,
      media_saved: media.filter((x) => x.file).length,
      media_failed: media.filter((x) => !x.file && !x.skipped && x.error).length,
      media_pending: media.filter((x) => !x.file && !x.skipped && !x.error).length,
      media_skipped: media.filter((x) => !x.file && x.skipped).length,
      media: { ...mediaCounts(media.map((x) => x.status)), left: list.reduce((t, m) => t + m.left, 0) },
      status: checks.status,
      problems: checks.problems,
      checked_at: checks.checked_at,
      // When another app's export last brought it in (Settings' Apps tab).
      ...(progress?.imported?.at ? { imported_at: progress.imported.at } : {}),
    };
  }

  const indexScript = (exp) => `window.GM_EXPORT = ${JSON.stringify({ ...exp, version: INDEX_VERSION })};\n`;
  const parseIndex = (text) => JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

  // Reads data.js. An index from before version 4 kept every message in
  // data.js; each of its chats gets its own chat.js and messages.csv here, once.
  // `io` is { readText(path) -> string|null, write(path, data) }.
  async function readLibrary(io, log = () => {}) {
    const text = await io.readText('data.js');
    if (!text) return null;
    const exp = parseIndex(text);
    const rows = [];
    let converted = 0;
    for (const c of exp.conversations || []) {
      if (!c?.folder) continue;
      if (c.file && !c.messages) { rows.push(c); continue; }
      let progress = null;
      try { progress = JSON.parse((await io.readText(`${c.folder}/progress.json`)) || 'null'); } catch { /* none */ }
      await io.write(`${c.folder}/chat.js`, chatScript(c.folder, c.messages || []));
      await io.write(`${c.folder}/messages.csv`, chatCsv(c.title, c.folder, c.messages || []));
      rows.push(summarize({ id: c.id, title: c.title, folder: c.folder, progress, compact: c }));
      converted++;
    }
    if (converted) log(`Gave ${converted} chat${converted === 1 ? '' : 's'} their own index files (faster saves from now on)`);
    return { exp, rows, converted };
  }

  // ---------- the restore package ----------
  // What the Android app (android/ in this project) restores from: one .tar
  // file, written a piece at a time, so years of texts and photos never have
  // to fit in memory. Tar because each entry is just a 512-byte header and the
  // bytes, with no size or file-count limits that matter here (zip needs Zip64
  // past 4 GB or 65,535 files). Entries:
  //   media/<n>.<ext>          photos, videos and voice notes, as saved
  //   threads/<nnnn>.ndjson    one JSON object per line per message (gzipped, .ndjson.gz, in version 3)
  //   manifest.json            last: format, totals and every thread
  // See notes/Restore package.md.
  const RESTORE_FORMAT = 'gm-restore';
  const RESTORE_VERSION = 1;
  function tarHeader(name, size, mtimeMs = Date.now()) {
    const h = new Uint8Array(512);
    const put = (str, off, len) => { for (let i = 0; i < Math.min(str.length, len); i++) h[off + i] = str.charCodeAt(i) & 0xff; };
    const oct = (n, len) => n.toString(8).padStart(len - 1, '0') + '\0';
    if (name.length > 100) throw new Error(`Name too long for the package: ${name}`);
    put(name, 0, 100);
    put('0000644\0', 100, 8);
    put('0000000\0', 108, 8);
    put('0000000\0', 116, 8);
    put(oct(size, 12), 124, 12);
    put(oct(Math.floor(mtimeMs / 1000), 12), 136, 12);
    put('        ', 148, 8); // checksum is summed with these as spaces
    h[156] = 0x30; // '0': a regular file
    put('ustar\0', 257, 6);
    put('00', 263, 2);
    let sum = 0;
    for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    return h;
  }
  const tarPadding = (size) => new Uint8Array((512 - (size % 512)) % 512);
  const tarEnd = () => new Uint8Array(1024);

  // The newest package format this reads: 2 lets a chat be in several pieces
  // (the Android app's daily backups). The extension itself writes 1.
  const RESTORE_READS = 3; // 3: a chat's files can be gzipped (.ndjson.gz)

  // ---------- phone numbers ----------

  const phoneDigits = (n) => (n || '').replace(/[^\d+]/g, '');

  // Who a chat's messages go to on the phone: the numbers on its contact card,
  // or, for a chat named by its number or a short code (texts from businesses),
  // that number.
  const NUMBER_TITLE = /^\+?[\d\s().-]{3,}$/;
  function restoreAddrs(people, title) {
    const nums = (people || []).map((p) => phoneDigits(p.number ?? p.num)).filter((n) => n.replace('+', '').length >= 3);
    if (nums.length) return nums;
    const t = phoneDigits(title);
    return NUMBER_TITLE.test(title || '') && t.replace('+', '').length >= 3 ? [t] : [];
  }

  // A phone number as Google Messages shows it: "(555) 020-0001" in North
  // America, "+44 770 090 0123" elsewhere. Short codes, names, and anything
  // too long to be one number stay as they are; a list is each of its numbers.
  function formatNumber(s) {
    const one = (t) => {
      const raw = t.trim();
      if (!NUMBER_TITLE.test(raw)) return raw;
      const d = raw.replace(/\D/g, '');
      if (d.length === 10 || (d.length === 11 && d[0] === '1')) { const x = d.slice(-10); return `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}`; }
      if (raw.startsWith('+') && d.length > 10 && d.length <= 15) { const x = d.slice(-10); return `+${d.slice(0, -10)} ${x.slice(0, 3)} ${x.slice(3, 6)} ${x.slice(6)}`; }
      return raw;
    };
    return String(s ?? '').split(/,\s*/).map(one).join(', ');
  }
  // Named only by its number (or numbers).
  const isNumberName = (s) => String(s || '').split(/,\s*/).every((t) => NUMBER_TITLE.test(t.trim()));

  // Chats in every list: favourites first (pinned in Messages, a starred
  // contact on the phone, or labelled Favorites), then chats with names A–Z,
  // then those known only by a number. `fav(row)` says which are favourites.
  const chatOrder = (fav = () => false) => (a, b) => (fav(b) - fav(a)) || (isNumberName(a.title) - isNumberName(b.title))
    || String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base', numeric: true });
  const isFavourite = (row) => !!(row.pinned || row.contact?.people?.some((p) => p.fav));

  // ---------- phone backups ----------
  // The Android app backs a phone up into the same package format (see
  // notes/Restore package.md), with exact times and the phone's own contact
  // names. These turn one into library chats; options.js imports them.

  // A phone number in a form that compares across formats: the last ten
  // digits ("+1 (555) 020-0000" and "5550200000" match), a short code's
  // digits, or a business's name ("AMAZON") in lower case.
  function phoneKey(a) {
    const d = String(a || '').replace(/\D/g, '');
    return d ? d.slice(-10) : String(a || '').trim().toLowerCase();
  }

  // Opens a package from its headers alone, read a window at a time so that
  // many small photos cost few reads. Entries come back as slices of the file.
  async function readPackage(blob) {
    // Say what's wrong in plain words: most often a download (from Google
    // Drive, say) that hadn't finished, which leaves an empty or cut-short file.
    if (!blob.size) throw new Error('That file is empty (0 bytes). If it came from Google Drive, its download didn’t finish: download it again and wait until it’s the backup’s full size (Drive asks “Download anyway?” for big files). Then bring it in.');
    const entries = new Map(); // name -> [offset, size]
    const WIN = 1 << 20;
    const dec = new TextDecoder();
    let win = null;
    let winAt = 0;
    for (let pos = 0; pos + 512 <= blob.size;) {
      if (!win || pos + 512 > winAt + win.length) { winAt = pos; win = new Uint8Array(await blob.slice(pos, Math.min(blob.size, pos + WIN)).arrayBuffer()); }
      const h = win.subarray(pos - winAt, pos - winAt + 512);
      if (h.every((b) => b === 0)) break;
      const str = (o, l) => { let e = o; while (e < o + l && h[e]) e++; return dec.decode(h.subarray(o, e)); };
      if (!entries.size && str(257, 5) !== 'ustar') throw new Error('That file isn’t a backup from the Message Archivist app (it isn’t a .tar backup at all). Pick the .tar file the app saved.');
      const prefix = str(345, 155);
      const size = parseInt(str(124, 12).trim() || '0', 8);
      entries.set((prefix ? `${prefix}/` : '') + str(0, 100), [pos + 512, size]);
      pos += 512 + Math.ceil(size / 512) * 512;
    }
    const entry = (name) => { const e = entries.get(name); return e ? blob.slice(e[0], e[0] + e[1]) : null; };
    const m = entry('manifest.json');
    // The list of chats is written last, so a file without it was cut short.
    if (!m) throw new Error(entries.size ? `That backup file is incomplete: it stops before its end (${(blob.size / 1e6).toFixed(0)} MB read), so the list of chats written last is missing. If it’s still downloading or syncing, wait until it’s finished; otherwise download it again, or make a new backup.` : 'That isn’t a phone backup from the Message Archivist app.');
    const manifest = JSON.parse(await m.text());
    if (manifest.format !== RESTORE_FORMAT) throw new Error('That isn’t a phone backup from the Message Archivist app.');
    if (manifest.version > RESTORE_READS) throw new Error('That backup is from a newer version of the Message Archivist app. Update the extension first.');
    // A chat's messages: gzipped by the Android app since version 3, plain before.
    const text = (b) => (/\.gz$/.test(b.name) ? new Response(b.blob.stream().pipeThrough(new DecompressionStream('gzip'))).text() : b.blob.text());
    const lines = async (name) => { const b = entry(name); return (b ? await text({ name, blob: b }) : '').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)); };
    // A chat kept up to date by daily phone backups is in several pieces (`files`, version 2), oldest first.
    const threadLines = async (t) => (await Promise.all((t.files || [t.file]).map(lines))).flat();
    return { manifest, entry, lines, threadLines, size: (name) => entries.get(name)?.[1] ?? 0 };
  }

  const pad2 = (x) => String(x).padStart(2, '0');
  // Milliseconds as the library writes times: "YYYY-MM-DD HH:MM", local time.
  const localMinute = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

  // One phone chat as library records. Sent messages are "Me", as in a
  // backup from Google Messages for Web; received ones are under the phone's
  // name for the sender (options.js swaps in the library's own names when the
  // chat is already there), with the number kept beside it. Each photo gets
  // the library's usual name, and `files` maps those names to the package.
  function phoneChat(thread, lines, sizeOf = () => null, at = null) {
    const names = thread.names || {};
    const group = thread.addresses.length > 1;
    const files = new Map();
    const messages = lines.map((l) => {
      const sent = l.box === 2;
      const number = sent ? null : l.from || (group ? null : thread.addresses[0]) || null;
      const sender = sent ? 'Me' : (number && names[number]) || (group ? number : thread.title) || number || 'Unknown';
      const timestamp = localMinute(l.date);
      const m = {
        direction: sent ? 'sent' : 'received', sender, ...(number ? { sender_number: number } : {}), text: l.text || '',
        timestamp, timestamp_precision: 'message', timestamp_raw: new Date(l.date).toISOString(), phone_id: l.src_id || null,
        ...(l.subject ? { subject: l.subject } : {}), media: [],
      };
      for (const p of l.parts || []) {
        const ct = p.ct || '';
        const kind = ct === 'image/gif' ? 'gif' : ct.startsWith('image/') ? 'image' : ct.startsWith('video/') ? 'video' : ct.startsWith('audio/') ? 'audio' : 'file';
        // Backed up without photos: the photo is known to be there, not saved yet.
        if (!p.file) { m.media.push({ kind, file: null, source: 'phone backup', content_type: ct || null, ...(p.name ? { original_name: p.name } : {}), ...(p.id ? { phone_part: p.id } : {}) }); continue; }
        const ext = (p.file.match(/\.[a-z0-9]{1,5}$/i) || [''])[0].toLowerCase();
        const base = `media/${timestamp.replace(':', '.')} - ${safeName(sender)}`;
        let name = `${base}${ext}`;
        for (let n = 2; files.has(name); n++) name = `${base} (${n})${ext}`;
        files.set(name, p.file);
        m.media.push({
          kind,
          file: name, bytes: sizeOf(p.file), source: 'phone backup', content_type: ct || null, ...(p.name ? { original_name: p.name } : {}), ...(p.id ? { phone_part: p.id } : {}),
        });
      }
      return m;
    });
    // Who's in the chat, as the phone's contacts have them: starred ones are
    // favourites, and their photo (a small one, in the package) and the rest
    // of their contact (`card`: other numbers and emails, work, birthday,
    // labels, relations) come along.
    const info = new Map((thread.people || []).map((p) => [p.address, p]));
    const people = thread.addresses.map((a) => {
      const p = info.get(a) || {};
      const name = names[a] || a;
      let photo = null;
      if (p.photo) { photo = `contact/${safeName(name)}${(p.photo.match(/\.[a-z0-9]{1,5}$/i) || ['.jpg'])[0]}`; files.set(photo, p.photo); }
      return { name, number: a, ...(p.starred ? { favorite: true } : {}), ...(photo ? { photo } : {}), ...(p.contact ? { card: p.contact } : {}) };
    });
    return {
      data: { conversation: thread.title || thread.addresses.join(', '), conversation_id: null, participants: [...new Set(messages.map((m) => m.sender))], messages,
        contact: { captured_at: at, source: 'phone backup', people } },
      files,
    };
  }

  // The library chat a phone chat belongs to: the one with the same phone
  // numbers (on its contact card, or as its name), else one with the same
  // name and no numbers to go by.
  function phoneRowFor(rows, thread) {
    const want = new Set(thread.addresses.map(phoneKey));
    const keys = (r) => new Set(restoreAddrs(r.contact?.people, r.title).map(phoneKey));
    return rows.find((r) => { const k = keys(r); return k.size === want.size && [...k].every((x) => want.has(x)); })
      || rows.find((r) => !keys(r).size && r.title.toLowerCase() === (thread.title || '').toLowerCase()) || null;
  }

  // Received phone messages under the names the library already uses for
  // those people (from its contact card; in a one-to-one chat, its name).
  function useLibraryNames(incoming, row) {
    const people = row.contact?.people || [];
    const byNumber = new Map(people.filter((p) => p.num ?? p.number).map((p) => [phoneKey(p.num ?? p.number), p.n ?? p.name]));
    const oneToOne = restoreAddrs(people, row.title).length <= 1;
    for (const m of incoming) {
      if (m.direction === 'received') m.sender = byNumber.get(phoneKey(m.sender_number)) || (oneToOne ? row.title : m.sender);
    }
  }

  // Phone messages have no Google message ID, and Google Messages for Web can
  // show a photo and its caption as two messages, so matching is looser than
  // keyOf: two messages are the same when they're from the same side, in the
  // same minute (or the one before or after), with the same text, or for a
  // photo with no text, a photo. Each message stands in for one other only,
  // so two "ok"s need two "ok"s. Used both ways: a phone backup coming into
  // the library (unknownPhone), and a backup from the web meeting messages
  // that came from a phone (content.js claims them).
  const normText = (t) => String(t || '').replace(/\s+/g, ' ').trim();
  function phoneSlots(messages) {
    const slots = new Map(); // "minute|direction" -> messages
    for (const m of messages) {
      if (!m.timestamp) continue;
      const k = `${m.timestamp}|${m.direction}`;
      if (!slots.has(k)) slots.set(k, []);
      slots.get(k).push(m);
    }
    return slots;
  }
  // Takes the message in `slots` that `p` matches out of them, and returns it (or null).
  function claimPhone(slots, p) {
    if (!p.timestamp) return null;
    const text = normText(p.text);
    const pics = (p.media || []).length > 0;
    const t = new Date(p.timestamp.replace(' ', 'T')).getTime();
    for (const ts of [p.timestamp, localMinute(t - 60e3), localMinute(t + 60e3)]) {
      const list = slots.get(`${ts}|${p.direction}`);
      const i = list ? list.findIndex((m) => (text ? normText(m.text) === text : pics && (m.media || []).length > 0)) : -1;
      if (i >= 0) return list.splice(i, 1)[0];
    }
    return null;
  }
  // A backup from the web meeting messages that came from a phone: each
  // message on the page claims the phone message it matches, which takes the
  // page's ID. A phone message with a photo and a caption can be two messages
  // on the page; the second half then claims it too (kept in `also_ids`), but
  // only if it brings the other half (just the photo, or just the text), so
  // two real "ok"s stay two.
  function phoneClaims(saved) {
    const left = phoneSlots(saved.filter((r) => r.phone_id && !r.id));
    const halves = new Map();
    const half = (m) => (m.text ? ((m.media || []).length ? '' : 'text') : 'media');
    return {
      claim(m) {
        if (!m.id) return null;
        const r = left.size ? claimPhone(left, m) : null;
        if (r) {
          r.id = m.id;
          if (r.text && r.media?.length && half(m)) {
            const rest = half(m) === 'text' ? { text: '', media: r.media } : { text: r.text, media: [] };
            const k = `${r.timestamp}|${r.direction}`;
            halves.set(k, [...(halves.get(k) || []), { timestamp: r.timestamp, direction: r.direction, ...rest, rec: r }]);
          }
          return r;
        }
        const h = halves.size ? claimPhone(halves, m) : null;
        if (!h) return null;
        h.rec.also_ids = [...(h.rec.also_ids || []), m.id];
        return h.rec;
      },
    };
  }

  function unknownPhone(saved, incoming) {
    const slots = phoneSlots(saved);
    return incoming.filter((p) => !claimPhone(slots, p));
  }

  // ---------- checksums ----------

  function parseSums(text) {
    const sums = new Map();
    for (const line of (text || '').split('\n')) {
      const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
      if (m) sums.set(m[2], m[1]);
    }
    return sums;
  }
  const formatSums = (sums) => [...sums].filter(([p]) => p !== 'SHA256SUMS.txt').sort((a, b) => a[0].localeCompare(b[0])).map(([p, h]) => `${h}  ${p}`).join('\n') + '\n';

  async function sha256(data) {
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const safeName = (s) => (s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 60) || 'Conversation';

  // The scripts and styles a page loads from beside it (its own tags; not
  // data: and not what it loads itself, as the viewer does data.js): what goes
  // into the backup folder with the viewer, as its index.html, the app
  // modules included.
  const pageFiles = (html) => [...String(html).matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^":#?]+\.(?:js|css))"/g)].map((m) => m[1]);

  const README = `Message Archivist library: your conversations, from every app

index.html                          Open this in your browser: every chat, search,
                                    drill-downs, media and stats, all offline.
viewer.js, library.js, theme.*,     What index.html runs on, with modules/ (one file
modules/, data.js                   per app). Keep them next to it.
messages.csv                        Every message of every chat in one spreadsheet.
verification.json                   How complete each chat's backup is, and why:
                                    first message reached, newest saved, media,
                                    duplicates, and which conversations aren't backed up.
export-info.json                    Who/what/when: tool version, browser, timezone,
                                    and a record of every backup, update and import.
logs/                               The full step-by-step log of each run.
SHA256SUMS.txt                      SHA-256 checksum of every file. To check nothing
                                    has changed since:  shasum -a 256 -c SHA256SUMS.txt
labels.json, labels.js              Your labels, flags and notes (not in the checksums).
people.json, people.js              Who's who: chats you joined as one person, split
                                    apart or renamed in the viewer's People tab.
contacts.json, contacts.js          Your phone's address book, from a phone backup with
                                    "Save all my contacts" on: ties chats from every app
                                    to the contact they're with.
Obsidian/                           Notes for Obsidian, if you turned them on: open
                                    this folder (the whole backup) as a vault.
conversations/<contact>/            A text-message chat (SMS, MMS and RCS).
conversations/<App>/<contact>/      A chat from another app (WhatsApp, Telegram,
                                    Discord, Instagram, Messenger, TikTok,
                                    Snapchat...), brought in from that app's
                                    own export.
  messages.json                     The chat, machine readable, including each
                                    app's message IDs and the exact times.
  progress.json                     How far the backup has got, the evidence that it
                                    reached the first message, and its checks.
  media-index.json, .csv            Every photo and video in the chat with its status:
                                    full size, thumbnail, not fetched yet, failed...
  journal/                          Messages saved during a backup, before they're
                                    added to messages.json. Gone when it finishes.
  chat.js, messages.csv             This chat for the viewer, and as a spreadsheet.
  contact.json, contact/            Names, numbers and contact photos.
  media/                            Photos, GIFs, videos and audio, named
                                    "<date> <time> - <sender>.<ext>".

To add new text messages later, open messages.google.com and use the
extension: "Back up this chat", the backup list, or "Back up everything" in
its Settings. To add another app's chats, export them from that app and use
Settings -> Tools -> "Bring in files...".

Timestamps
  timestamp            Normalised to your local time, "YYYY-MM-DD HH:MM".
  timestamp_precision  "message": the time shown for that exact message.
                       "section": the time of the date heading above it.
                       "day":     only the date was known.
  timestamp_raw        Exactly what the page showed, so you can double-check.

Media is saved byte-for-byte as Google Messages for Web had it. "source" in
messages.json says whether a photo came from the full-size viewer or the chat
thumbnail. RCS photos are full size; SMS/MMS photos are compressed by the carrier.
`;

  return {
    SETTINGS_VERSION, SETTINGS_DEFAULTS, normalizeSettings,
    RESTORE_FORMAT, RESTORE_VERSION, tarHeader, tarPadding, tarEnd,
    phoneDigits, restoreAddrs, formatNumber, isNumberName, chatOrder, isFavourite, phoneKey, readPackage, phoneChat, phoneRowFor, useLibraryNames, phoneSlots, claimPhone, phoneClaims, unknownPhone,
    SERVICES, addModule, modules, module: moduleOf, serviceOf, serviceLabel, appFolder, chatFolder, importedRecord, pageFiles, accountKey, accountOf, sameAccount, accountLabel,
    PEOPLE_VERSION, chatKey, isGroupChat, isPersonChat, personIds, personName, nameKey, people, peopleSaved, joinPeople, keepApart, splitChat, renamePerson,
    CHAT_KINDS, TRAITS_VERSION, chatTraits, traitsCurrent, senderOf, chatKind, chatKindFor, skipKinds,
    INDEX_VERSION, sigOf, keyOf, unknownIn, mergeChrono, imageFingerprint, sameImage, betterCopy,
    MEDIA_STATUS, mediaStatus, mediaIndex, mediaCounts, mediaIndexCsv,
    compactMessages, chatScript, contactSummary, chatCsv, joinCsv,
    checkChat, STATUS_LABEL, verificationOf, summarize, indexScript, parseIndex, readLibrary,
    parseSums, formatSums, sha256, safeName, README,
  };
})();
