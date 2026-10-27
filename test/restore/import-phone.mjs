// Checks how a phone backup from the Android app is matched to a library:
// chats by phone number, messages already saved skipped, names taken from
// the library. Builds its own made-up phone backup and library.
// node test/restore/import-phone.mjs extension/library.js
import { readFileSync } from 'node:fs';
new Function(readFileSync(process.argv[2], 'utf8'))();
const G = globalThis.GMLib;

let failed = 0;
const check = (what, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`); if (!ok) failed++; };

// ---- a phone backup: five chats ----
const T0 = new Date(2024, 0, 1, 9, 0).getTime();
const chats = [
  { key: 'A', addresses: ['+15550100001'], names: { '+15550100001': 'Alex Test' }, n: 200 },
  { key: 'B', addresses: ['+15550100011', '+15550100012', '+15550100013'], names: { '+15550100011': 'Bo Test', '+15550100012': 'Cy Test' }, n: 60 },
  { key: 'C', addresses: ['+15550100021'], names: {}, n: 40 },
  { key: 'D', addresses: ['BUSINESS'], names: {}, n: 12 },
  { key: 'E', addresses: ['72975'], names: {}, n: 8 },
];
const parts = [];
const entry = (name, buf) => parts.push(G.tarHeader(name, buf.length), buf, G.tarPadding(buf.length));
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
let media = 0;
const threads = [];
const phoneLines = {};
chats.forEach((c, k) => {
  const lines = [];
  let t = T0 + k * 86400e3;
  for (let i = 0; i < c.n; i++) {
    t += (i % 7 === 3 ? 20e3 : 600e3); // some messages a few seconds apart, in the same minute
    const sent = i % 3 === 0;
    const from = sent ? undefined : c.addresses[i % c.addresses.length];
    const withPic = i % 25 === 5;
    const pics = withPic ? [{ file: `media/${++media}.png`, ct: 'image/png', name: `IMG_${media}.png` }] : [];
    if (withPic) entry(pics[0].file, png);
    const text = c.key === 'A' && (i === 50 || i === 51) ? 'ok' : withPic && i % 2 ? '' : `${c.key} message ${i + 1}`;
    lines.push({ date: t, box: sent ? 2 : 1, kind: withPic || c.addresses.length > 1 ? 'mms' : 'sms', addrs: c.addresses, ...(from ? { from } : {}), text, ...(pics.length ? { parts: pics } : {}), src_id: `sms:${k}${i}` });
  }
  // A's 51st and 52nd messages: "ok" twice, from the same side, in the same minute.
  if (c.key === 'A') { lines[51].date = lines[50].date + 5e3; lines[51].box = lines[50].box; delete lines[51].from; if (lines[50].from) lines[51].from = lines[50].from; }
  const file = `threads/${String(k + 1).padStart(4, '0')}.ndjson`;
  entry(file, Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n'));
  const title = c.addresses.map((a) => c.names[a] || a).join(', ');
  threads.push({ file, title, addresses: c.addresses, group: c.addresses.length > 1, messages: lines.length, first: lines[0].date, last: lines.at(-1).date, names: c.names });
  phoneLines[c.key] = lines;
});
entry('manifest.json', Buffer.from(JSON.stringify({ format: G.RESTORE_FORMAT, version: G.RESTORE_VERSION, created_at: new Date().toISOString(), tool: 'Message Archivist', source: 'phone', counts: { threads: threads.length, media }, threads })));
parts.push(G.tarEnd());
const pkg = await G.readPackage(new Blob(parts));
check('package opens', pkg.manifest.threads.length === 5);

// ---- a library: the same chats as Google Messages for Web saved them ----
// A: named differently, number written differently; ten messages missing,
//    a photo and its caption as two messages, one time a minute later, one "ok" of the two.
// B: the group, numbers in another order, every message there, own names.
// C: not in the library.  D: a business with no number, matched by name.  E: a short code.
const libNames = { '+15550100001': 'Alex T.', '+15550100011': 'Bo T.', '+15550100012': 'Cy T.', '+15550100013': 'Di T.' };
const rows = [
  { title: 'Alex T.', folder: 'conversations/Alex T.', contact: { people: [{ n: 'Alex T.', num: '(555) 010-0001' }] } },
  { title: 'Bo, Cy and Di', folder: 'conversations/Bo, Cy and Di', contact: { people: [{ n: 'Di T.', num: '+1 555-010-0013' }, { n: 'Bo T.', num: '555 010 0011' }, { n: 'Cy T.', num: '+15550100012' }] } },
  { title: 'Business', folder: 'conversations/Business', contact: null },
  { title: '72975', folder: 'conversations/72975', contact: null },
  { title: 'Someone else', folder: 'conversations/Someone else', contact: { people: [{ n: 'Someone else', num: '+15550109999' }] } },
];
const minute = (ms) => { const d = new Date(ms); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const scraped = (c, lines, row) => {
  const out = [];
  lines.forEach((l, i) => {
    const sender = l.box === 2 ? 'Me' : libNames[l.from] || row.title;
    const rec = { id: `g-${c.key}-${i}`, direction: l.box === 2 ? 'sent' : 'received', sender, text: l.text, timestamp: minute(l.date), timestamp_precision: 'message', media: (l.parts || []).map(() => ({ kind: 'image', file: 'media/x.png' })) };
    if (c.key === 'A') {
      if (i >= 100 && i < 110) return; // missing
      if (i === 51) return; // only one "ok"
      if (i === 120) rec.timestamp = minute(l.date + 60e3); // a minute later on the page
      if (i === 105 + 25) { out.push({ ...rec, id: `${rec.id}a`, media: [] }, { ...rec, id: `${rec.id}b`, text: '' }); return; } // photo and caption apart
    }
    out.push(rec);
  });
  return out;
};

const expectFresh = { A: 11, B: 0, C: 40, D: 0, E: 0 };
for (const [k, c] of chats.entries()) {
  const t = pkg.manifest.threads[k];
  const row = G.phoneRowFor(rows, t);
  const wantRow = { A: rows[0], B: rows[1], C: null, D: rows[2], E: rows[3] }[c.key];
  check(`chat ${c.key} matched`, row === wantRow, row ? row.title : 'new chat');
  const { data, files } = G.phoneChat(t, await pkg.lines(t.file), pkg.size);
  for (const [name, e] of files) if (!pkg.entry(e) || pkg.size(e) !== png.length) check(`chat ${c.key} photo ${name}`, false);
  if (row) G.useLibraryNames(data.messages, row);
  const saved = row ? scraped(c, phoneLines[c.key], row) : [];
  const fresh = G.unknownPhone(saved, data.messages);
  check(`chat ${c.key} new messages`, fresh.length === expectFresh[c.key], `${fresh.length} of ${data.messages.length}`);
  if (c.key === 'A') {
    const okIdx = fresh.filter((m) => m.text === 'ok').length;
    check('A: the second "ok" comes in', okIdx === 1);
    check('A: received under the library\'s name', data.messages.filter((m) => m.direction === 'received').every((m) => m.sender === 'Alex T.'));
    const merged = G.mergeChrono(saved, fresh, data.messages);
    check('A: merged in time order', merged.length === saved.length + 11 && merged.every((m, i) => !i || merged[i - 1].timestamp <= m.timestamp));
  }
  if (c.key === 'B') {
    const senders = new Set(data.messages.filter((m) => m.direction === 'received').map((m) => m.sender));
    check('B: group senders under the library\'s names', [...senders].every((s) => Object.values(libNames).includes(s)), [...senders].join(', '));
  }
  if (c.key === 'C') check('C: a new chat named from the phone', data.conversation === '+15550100021' && data.contact.people[0].number === '+15550100021');
}
// Importing the same phone backup twice adds nothing the second time.
{
  const t = pkg.manifest.threads[0];
  const once = G.phoneChat(t, await pkg.lines(t.file), pkg.size).data.messages;
  G.useLibraryNames(once, rows[0]);
  const again = G.phoneChat(t, await pkg.lines(t.file), pkg.size).data.messages;
  G.useLibraryNames(again, rows[0]);
  check('A imported twice: nothing new', G.unknownPhone(once, again).length === 0);
}
// Phone first, then a backup from the web: each web message claims the phone
// message it matches (taking its Google ID); the photo and caption the web
// shows apart both claim the one phone message; sent RCS messages the phone
// never stored are left over, to be added.
{
  const t = pkg.manifest.threads[0];
  const phone = G.phoneChat(t, await pkg.lines(t.file), pkg.size).data.messages;
  const web = scraped(chats[0], phoneLines.A, rows[0]).filter((m) => !m.id.startsWith('g-A-10')); // the web's own gaps
  const extra = [0, 1, 2].map((k) => ({ id: `rcs-${k}`, direction: 'sent', sender: 'Me', text: `sent over RCS ${k}`, timestamp: minute(T0 + (500 + k) * 3600e3), media: [] }));
  const claims = G.phoneClaims(phone);
  const left = [...web, ...extra].filter((m) => !claims.claim(m));
  check('web after phone: only the RCS messages are new', left.length === 3 && left.every((m) => m.id.startsWith('rcs-')), left.map((m) => m.id).join(', '));
  const split = phone.find((m) => m.also_ids);
  check('web after phone: a split photo claims one message', !!split && split.media.length === 1 && split.also_ids.length === 1);
  check('web after phone: claimed messages take Google IDs', phone.filter((m) => m.id).length === web.length - 1);
  // Next time, as content.js does, messages whose ID is saved are known before any claiming.
  const ids = new Set([...phone.flatMap((m) => [m.id, ...(m.also_ids || [])]), ...extra.map((m) => m.id)].filter(Boolean));
  const again = G.phoneClaims(phone);
  check('web after phone: a second run claims nothing', [...web, ...extra].filter((m) => !ids.has(m.id)).every((m) => !again.claim(m)));
}
// A phone backup made without photos: each photo is known to be there.
{
  const t = pkg.manifest.threads[0];
  const lines = (await pkg.lines(t.file)).map((l) => (l.parts ? { ...l, parts: l.parts.map(({ file, ...p }) => p) } : l));
  const { data, files } = G.phoneChat(t, lines, pkg.size);
  const waiting = data.messages.flatMap((m) => m.media);
  check('without photos: photos listed, waiting', waiting.length === lines.filter((l) => l.parts).length && waiting.every((md) => md.file === null && md.kind === 'image') && files.size === 0);
}
// A chat kept up to date by daily backups: in two pieces (format version 2).
{
  const parts2 = [];
  const add = (name, buf) => parts2.push(G.tarHeader(name, buf.length), buf, G.tarPadding(buf.length));
  const line = (i) => JSON.stringify({ date: T0 + i * 60e3, box: 1, kind: 'sms', addrs: ['+15550100001'], from: '+15550100001', text: `piece message ${i}` });
  add('threads/0001.ndjson', Buffer.from(`${line(1)}\n${line(2)}\n`));
  add('threads/0001.2.ndjson', Buffer.from(`${line(3)}\n`));
  add('manifest.json', Buffer.from(JSON.stringify({ format: G.RESTORE_FORMAT, version: 2, source: 'phone', threads: [{ file: 'threads/0001.ndjson', files: ['threads/0001.ndjson', 'threads/0001.2.ndjson'], title: 'Alex Test', addresses: ['+15550100001'], messages: 3 }] })));
  parts2.push(G.tarEnd());
  const p2 = await G.readPackage(new Blob(parts2));
  const got = await p2.threadLines(p2.manifest.threads[0]);
  check('version 2: a chat in pieces reads whole, in order', got.map((l) => l.text).join('|') === 'piece message 1|piece message 2|piece message 3');
}
// How chats and numbers are shown: favourites, names A–Z, numbers last; numbers one way.
check('numbers shown one way', G.formatNumber('+15550100001') === '(555) 010-0001' && G.formatNumber('5550100001, +15550100002') === '(555) 010-0001, (555) 010-0002' && G.formatNumber('72975') === '72975' && G.formatNumber('Robin') === 'Robin');
{
  const list = [{ title: '+15550100009' }, { title: 'zed' }, { title: 'Alex' }, { title: 'Mum', pinned: true }, { title: '72975' }, { title: 'bo', contact: { people: [{ fav: 1 }] } }];
  check('favourites, then names A–Z, then numbers', list.sort(G.chatOrder(G.isFavourite)).map((c) => c.title).join('|') === 'bo|Mum|Alex|zed|+15550100009|72975');
}
// A chat from a phone backup isn't "Unfinished": it's "From phone".
{
  const msgs = [{ timestamp: '2024-01-01 09:00', direction: 'sent', sender: 'Me', text: 'hi', media: [] }];
  const st = (p) => G.checkChat(msgs, p, { people: [{ name: 'A', number: '+15550100001' }] }).status;
  check('phone chats: From phone', st({ from_phone: { file: 'x.tar', at: '2026-01-01T00:00:00Z' } }) === 'phone' && st({ imported_from: 'x.zip' }) === 'incomplete' && st({ history_complete: true, from_phone: { file: 'x.tar' } }) !== 'phone');
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
