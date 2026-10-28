// Checks who's who across apps, accounts and numbers (GMLib.people and the
// owner's joins, splits and names), and the Obsidian notes made from a small
// library (GMObsidian): where they go, how a chat's messages are split into
// notes, that message text reads literally, photos embedded, and that updates
// leave unchanged notes and the owner's own notes alone. All names, numbers
// and texts here are invented.
// node test/people/run.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EXT = 'extension';
// The library, the app modules (each app's name and how its people are known), and the notes.
for (const f of ['library.js', ...readdirSync(join(EXT, 'modules')).filter((f) => f.endsWith('.js')).sort().map((f) => `modules/${f}`), 'obsidian.js']) new Function(readFileSync(join(EXT, f), 'utf8'))();
const G = globalThis.GMLib;
const O = globalThis.GMObsidian;

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failed++; };

const row = (o) => ({ count: 10, first: '2024-01-01 10:00', last: '2024-02-01 10:00', participants: ['Me'], ...o });
const ROWS = [
  row({ id: 'gm-1', title: 'Sam Rivers', folder: 'conversations/Sam Rivers', contact: { people: [{ n: 'Sam Rivers', num: '+1 555-010-0101' }] }, count: 100, first: '2023-12-30 09:00', last: '2024-02-03 18:00' }),
  row({ id: 'whatsapp:+1 555 010 0101', service: 'whatsapp', title: '+1 555 010 0101', folder: 'conversations/WhatsApp/+1 555 010 0101', contact: { people: [{ n: '+1 555 010 0101' }] }, count: 40 }),
  row({ id: 'instagram:t1', service: 'instagram', title: 'Sam Rivers', folder: 'conversations/Instagram/Sam Rivers', contact: { people: [{ n: 'Sam Rivers' }] }, count: 5 }),
  row({ id: 'gm-2', title: '(555) 010-0102', folder: 'conversations/(555) 010-0102', contact: { people: [{ n: '(555) 010-0102', num: '5550100102' }] } }),
  row({ id: 'telegram:1', service: 'telegram', title: 'Jo Park', folder: 'conversations/Telegram/Jo Park', contact: { people: [{ n: 'Jo Park', h: 'user77' }] }, count: 30 }),
  row({ id: 'telegram:2', service: 'telegram', account: '+15550100999', account_label: '(555) 010-0999', title: 'Jo P.', folder: 'conversations/Telegram - (555) 010-0999/Jo P', contact: { people: [{ n: 'Jo P.', h: 'User77' }] }, count: 3 }),
  row({ id: 'gm-3', title: 'Family', folder: 'conversations/Family', contact: { people: [{ n: 'Sam Rivers', num: '5550100101' }, { n: 'Jo Park', num: '5550100104' }] } }),
  row({ id: 'discord:9', service: 'discord', title: 'general', group: true, folder: 'conversations/Discord/general' }),
  row({ id: 'telegram:3', service: 'telegram', title: 'Saved Messages', folder: 'conversations/Telegram/Saved Messages' }),
  row({ id: 'gm-4', title: '72727', folder: 'conversations/72727' }),
  row({ id: 'gm-5', title: 'Alex Doe', folder: 'conversations/Alex Doe', contact: { people: [{ n: 'Alex Doe', num: '5550100105' }] } }),
  row({ id: 'messenger:a', service: 'messenger', title: 'Alex Doe', folder: 'conversations/Messenger/Alex Doe', contact: { people: [{ n: 'Alex Doe' }] } }),
];
const byTitle = (P, title, service = 'sms') => P.list.find((p) => p.chats.some((r) => r.title === title && G.serviceOf(r) === service));

// ---------- who's who ----------
{
  const P = G.people(ROWS);
  const sam = byTitle(P, 'Sam Rivers');
  check('a number joins texts and WhatsApp, however it is written', sam.chats.length === 2 && sam.chats.some((r) => r.service === 'whatsapp'), sam.chats.map((r) => r.title).join(', '));
  check('the person is named from your contacts, not the number', sam.name === 'Sam Rivers' && sam.count === 140, `${sam.name} ${sam.count}`);
  check('their first and last message across chats', sam.first === '2023-12-30 09:00' && sam.last === '2024-02-03 18:00', `${sam.first} ${sam.last}`);
  const jo = byTitle(P, 'Jo Park', 'telegram');
  check('the same handle in two accounts of an app is one person', jo.chats.length === 2 && jo.name === 'Jo Park', jo.chats.map((r) => r.title).join(', '));
  check('group chats, channels and Saved Messages are nobody', !P.byChat.has('gm-3') && !P.byChat.has('discord:9') && !P.byChat.has('telegram:3'));
  check('a short code is someone (a business)', !!P.byChat.get('gm-4'));
  const insta = byTitle(P, 'Sam Rivers', 'instagram');
  check('a name in common is not enough by itself', insta !== sam);
  const sugg = P.suggestions.map((s) => [s.a.name, s.b.name, s.name].join('/'));
  check('…but it is suggested', P.suggestions.some((s) => [s.a, s.b].includes(sam) && [s.a, s.b].includes(insta)), sugg.join('; '));
  check('suggestions pair people, once', P.suggestions.length === 2, sugg.join('; '));
  check('groups someone is in, by number', P.groupsOf(sam).map((r) => r.id).join() === 'gm-3');
  check('one app\'s name doesn\'t put them in another app\'s group', P.groupsOf(jo).length === 0);
  const kim = [
    row({ id: 'k1', title: 'Kim Lee', folder: 'conversations/Kim Lee', contact: { people: [{ n: 'Kim Lee', num: '5550100301' }] } }),
    row({ id: 'k2', title: 'Kim Lee', folder: 'conversations/Kim Lee (2)', contact: { people: [{ n: 'Kim Lee', num: '5550100302' }] } }),
    row({ id: 'kg', title: 'Kim Lee, Ray', folder: 'conversations/Kim Lee, Ray', contact: { people: [{ n: 'Kim Lee', num: '5550100301' }, { n: 'Ray', num: '5550100303' }] } }),
    row({ id: 'kh', title: 'Kim Lee, Ray', folder: 'conversations/Kim Lee, Ray (2)', contact: { people: [{ n: 'Kim Lee' }, { n: 'Ray' }] } }),
  ];
  const K = G.people(kim);
  // From a phone backup: the phone's contact joins a person's numbers.
  const card = { key: 'lk-1', numbers: ['+15550100401', '+15550100402'], emails: ['lee@example.com'] };
  const two = [
    row({ id: 'c1', title: 'Lee', folder: 'conversations/Lee', contact: { people: [{ n: 'Lee', num: '+15550100401', card }] } }),
    row({ id: 'c2', title: 'Lee', folder: 'conversations/Lee (2)', contact: { people: [{ n: 'Lee', num: '+15550100402' }] } }),
  ];
  const LP = G.people(two);
  check('a phone contact with two numbers is one person', LP.list.length === 1 && LP.list[0].ids.includes('contact:lk-1') && LP.list[0].ids.includes('email:lee@example.com'), LP.list.map((p) => p.ids.join()).join(' / '));
  const pc = G.phoneChat({ title: 'Lee', addresses: ['+15550100401'], names: { '+15550100401': 'Lee' }, people: [{ address: '+15550100401', name: 'Lee', starred: true, contact: card }] }, [], () => null, null);
  check('a phone backup\'s contact comes into the card', pc.data.contact.people[0].card === card && pc.data.contact.people[0].favorite === true);
  check('…and stays in the index', G.contactSummary('conversations/Lee', pc.data.contact).people[0].card === card);

  // The phone's address book (contacts.json): every app's chats tied to contacts.
  const BOOKED = { format: 'gm-address-book', version: 1, captured_at: '2026-10-01T00:00:00Z', contacts: [
    { key: 'kd', name: 'Dana Fox', numbers: ['+15550100501', '+15550100502'], birthday: '--07-09', labels: ['Work'] },
    { key: 'k1', name: 'Kim', numbers: ['+15550100511'] }, { key: 'k2', name: 'Kim', numbers: ['+15550100512'] },
  ] };
  const apps = [
    row({ id: 'd1', title: 'Dana', folder: 'conversations/Dana', contact: { people: [{ n: 'Dana', num: '+1 555-010-0501' }] } }),
    row({ id: 'whatsapp:dana', service: 'whatsapp', title: 'Dana Fox', folder: 'conversations/WhatsApp/Dana Fox', contact: { people: [{ n: 'Dana Fox' }] } }),
    row({ id: 'telegram:9', service: 'telegram', title: '+1 555 010 0502', folder: 'conversations/Telegram/+1 555 010 0502', contact: { people: [{ n: '+1 555 010 0502' }] } }),
    row({ id: 'instagram:dana', service: 'instagram', title: 'Dana Fox', folder: 'conversations/Instagram/Dana Fox', contact: { people: [{ n: 'Dana Fox' }] } }),
    row({ id: 'whatsapp:kim', service: 'whatsapp', title: 'Kim', folder: 'conversations/WhatsApp/Kim', contact: { people: [{ n: 'Kim' }] } }),
    row({ id: 'whatsapp:g', service: 'whatsapp', title: 'Team', group: true, folder: 'conversations/WhatsApp/Team', contact: { people: [{ n: 'Dana Fox' }, { n: 'Ray' }] } }),
  ];
  const B = G.people(apps, null, BOOKED);
  const dana = B.byChat.get('d1');
  check('the address book ties a contact\'s texts, WhatsApp (by name) and Telegram (another number)', ['whatsapp:dana', 'telegram:9'].every((k) => B.byChat.get(k) === dana) && dana.chats.length === 3, dana.chats.map((r) => r.id).join());
  check('…named as in the address book, with their contact', dana.name === 'Dana Fox' && dana.contact?.key === 'kd' && dana.ids.includes('contact:kd'));
  check('…but a name from an app whose names aren\'t your contacts isn\'t enough', B.byChat.get('instagram:dana') !== dana);
  check('…nor a name two contacts have', !B.byChat.get('whatsapp:kim').contact);
  check('…and a group member known by name is that contact', B.groupsOf(dana).map((r) => r.id).join() === 'whatsapp:g');
  check('without the address book, as before', G.people(apps).byChat.get('whatsapp:dana') !== G.people(apps).byChat.get('d1'));
  check('a group member with a number is only that number\'s person, not everyone with their name', K.groupsOf(K.byChat.get('k1')).map((r) => r.id).join() === 'kg,kh' && K.groupsOf(K.byChat.get('k2')).map((r) => r.id).join() === 'kh',
    `${K.groupsOf(K.byChat.get('k1')).map((r) => r.id)} / ${K.groupsOf(K.byChat.get('k2')).map((r) => r.id)}`);
  check('ids say how they were matched', sam.ids.includes('tel:5550100101') && jo.ids.includes('telegram:user77'), [...sam.ids, ...jo.ids].join());

  // The owner's decisions.
  let saved = G.joinPeople(null, sam, insta);
  let Q = G.people(ROWS, saved);
  const sam2 = byTitle(Q, 'Sam Rivers');
  check('joined: one person with three chats', sam2.chats.length === 3 && byTitle(Q, 'Sam Rivers', 'instagram') === sam2);
  check('joined: no longer suggested', !Q.suggestions.some((s) => s.name === 'sam rivers'));
  saved = G.splitChat(saved, sam2, sam2.chats.find((r) => r.service === 'whatsapp'));
  Q = G.people(ROWS, saved);
  const wa = Q.byChat.get('whatsapp:+1 555 010 0101');
  check('split: the chat is someone of its own', wa.chats.length === 1 && byTitle(Q, 'Sam Rivers').chats.length === 2, `${wa.chats.length} ${byTitle(Q, 'Sam Rivers').chats.length}`);
  check('split: it is named by its number', wa.name === '(555) 010-0101', wa.name);
  saved = G.renamePerson(saved, byTitle(Q, 'Sam Rivers'), 'Sam (school)');
  Q = G.people(ROWS, saved);
  check('rename: the new name, kept with the person', byTitle(Q, 'Sam Rivers', 'instagram').name === 'Sam (school)' && byTitle(Q, 'Sam Rivers', 'instagram').named);
  const alex = byTitle(Q, 'Alex Doe');
  const fb = byTitle(Q, 'Alex Doe', 'messenger');
  check('rename: suggestions follow the names', Q.suggestions.length === 1 && Q.suggestions[0].name === 'alex doe', Q.suggestions.map((s) => s.name).join());
  saved = G.keepApart(saved, alex, fb);
  Q = G.people(ROWS, saved);
  check('not the same: the suggestion goes, both stay', Q.suggestions.length === 0 && byTitle(Q, 'Alex Doe') !== byTitle(Q, 'Alex Doe', 'messenger'));
  saved = G.joinPeople(saved, byTitle(Q, 'Alex Doe'), byTitle(Q, 'Alex Doe', 'messenger'));
  Q = G.people(ROWS, saved);
  check('joined after all: "not the same" is forgotten', byTitle(Q, 'Alex Doe') === byTitle(Q, 'Alex Doe', 'messenger') && !saved.apart.length);
  const back = JSON.parse(JSON.stringify(saved));
  check('decisions survive people.json', G.people(ROWS, back).list.length === Q.list.length && back.version === G.PEOPLE_VERSION);
}

// ---------- Obsidian ----------
const files = new Map();
let writes = [];
let removed = [];
const io = {
  readText: async (p) => (files.has(p) ? files.get(p) : null),
  write: async (p, d) => { files.set(p, String(d)); writes.push(p); },
  remove: async (p) => { files.delete(p); removed.push(p); },
};
const msg = (o) => ({ direction: 'received', sender: 'Sam Rivers', timestamp_precision: 'message', media: [], ...o });
files.set('conversations/Sam Rivers/messages.json', JSON.stringify({ messages: [
  msg({ index: 1, timestamp: '2023-12-30 09:00', text: 'Meet at #3 [[Room]] for $5, 50% off %%later%% ==now== <b>x</b> ~~no~~ a*b_c' }),
  msg({ index: 2, timestamp: '2023-12-30 09:05', direction: 'sent', sender: 'Me', text: '- not a list\n1. not numbered\n---\n    not code\nsee https://example.com/a_b#top', reply_to: { sender: 'Sam Rivers', text: 'Meet at #3' } }),
  msg({ index: 3, timestamp: '2024-01-02 10:00', text: '', media: [{ kind: 'image', file: 'media/2024-01-02 10.00 - Sam Rivers.jpg' }, { kind: 'image', file: 'media/pic #2.jpg' }, { kind: 'video', file: null, skipped: 'not in the export' }], reactions: ['❤️ Me'] }),
  msg({ index: 4, timestamp: '2024-01-02 10:01', kind: 'call', text: 'Missed call' }),
  msg({ index: 5, timestamp: '', text: 'no date' }),
] }));
files.set('conversations/WhatsApp/+1 555 010 0101/messages.json', JSON.stringify({ messages: [msg({ index: 1, timestamp: '2024-02-01 08:00', sender: '+1 555 010 0101', text: 'hi' })] }));
const LABELS = { labels: [{ id: 'family', name: 'Family' }], chats: { 'gm-3': ['family'] }, flags: { 'gm-1|1': { note: 'the plan' } } };
const rows = ROWS.slice();
// Every year split into months, however few messages: the small library's
// stand-in for a busy chat.
const MONTHLY = { small: 0, busyYear: 0 };
{
  const r = await O.update(io, { rows, labels: LABELS, ...MONTHLY });
  const has = (p) => files.has(p);
  check('a home note, everyone, and each source', has('Obsidian/Message Archivist.md') && has('Obsidian/People.md') && has('Obsidian/Chats/Google Messages.md') && has('Obsidian/Chats/WhatsApp.md'));
  check('a note for each person and chat', has('Obsidian/People/Sam Rivers.md') && has('Obsidian/Chats/Google Messages/Sam Rivers.md') && has('Obsidian/Chats/Telegram - (555) 010-0999/Jo P.md'));
  check('two people with one name get two notes', has('Obsidian/People/Sam Rivers (Instagram).md'), [...files.keys()].filter((p) => p.startsWith('Obsidian/People/')).join(', '));
  const jan = files.get('Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers 2024-01.md') || '';
  const dec = files.get('Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers 2023-12.md') || '';
  check('a note per month, and one for undated messages', !!jan && !!dec && has('Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers undated.md'));
  check('a busy year: a note a month, with its dates', dec.includes('month: 2023-12') && dec.includes('first: 2023-12-30'));
  check('month notes link the chat and the person', dec.includes('chat: "[[Obsidian/Chats/Google Messages/Sam Rivers|Sam Rivers]]"') && dec.includes('person: "[[Obsidian/People/Sam Rivers|Sam Rivers]]"'));
  check('…and the next month', dec.includes('[[Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers 2024-01|January 2024]] →'));
  check('days as headings', dec.includes('## Saturday, 30 December 2023'));
  for (const [what, s] of [['tags', '\\#3'], ['links', '\\[\\[Room\\]\\]'], ['maths', '\\$5'], ['comments', '\\%\\%later\\%\\%'], ['highlights', '\\=\\=now\\=\\='], ['HTML', '\\<b\\>'], ['strikeout', '\\~\\~no\\~\\~'], ['emphasis', 'a\\*b\\_c'], ['lists', '\n\\- not a list'], ['numbered lists', '\n1\\. not numbered'], ['rules', '\n\\---'], ['code blocks', '\nnot code']]) {
    check(`text reads literally: ${what}`, dec.includes(s), s);
  }
  check('web addresses stay links', dec.includes('see https://example.com/a_b#top'));
  check('replies are shown', dec.includes('*↳ Sam Rivers: “Meet at \\#3”*'));
  check('flagged messages carry their note', dec.includes('· ★') && dec.includes('★ *the plan*'));
  check('photos are embedded from the chat folder', jan.includes('![[conversations/Sam Rivers/media/2024-01-02 10.00 - Sam Rivers.jpg|320]]'));
  check('odd file names use a relative link', jan.includes('![pic \\#2.jpg](../../../../conversations/Sam%20Rivers/media/pic%20%232.jpg)'), jan.split('\n').find((l) => l.includes('pic')));
  check('media not saved says so', jan.includes('*(video not saved: not in the export)*'));
  check('reactions and calls', jan.includes('*❤️ Me*') && jan.includes('*Missed call* · 10:01'));
  const person = files.get('Obsidian/People/Sam Rivers.md');
  check('a person note: numbers, sources, chats and groups', person.includes('numbers: ["(555) 010-0101"]') && person.includes('sources: ["Google Messages","WhatsApp"]') && person.includes('[[Obsidian/Chats/WhatsApp/+1 555 010 0101|WhatsApp]]') && person.includes('[[Obsidian/Chats/Google Messages/Family|Family]]'));
  check('handles say their app', files.get('Obsidian/People/Jo Park.md').includes('handles: ["Telegram user77"]'));
  const fam = files.get('Obsidian/Chats/Google Messages/Family.md');
  check('a group note: its people and labels as tags', fam.includes('people: ["[[Obsidian/People/Sam Rivers|Sam Rivers]]"]') && fam.includes('tags: ["family"]') && fam.includes('and 1 more'));
  check('a chat note links each month', files.get('Obsidian/Chats/Google Messages/Sam Rivers.md').includes('- **2024**: [[Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers 2024-01|Jan]] (2)'));
  check('…and undated messages', files.get('Obsidian/Chats/Google Messages/Sam Rivers.md').includes('- [[Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers undated|Undated]] (1)'));
  check('the report adds up', r.notes === [...files.keys()].filter((p) => p.endsWith('.md')).length && r.written === r.notes && r.people === G.people(rows).list.length, JSON.stringify(r));

  // Again, with nothing new: nothing is rewritten.
  writes = [];
  const r2 = await O.update(io, { rows, labels: LABELS, ...MONTHLY });
  check('nothing new: no note is written again', writes.length === 1 && writes[0] === O.MANIFEST && r2.written === 0, writes.join(', '));

  // Your own notes in a person note stay; a month note follows new messages.
  files.set('Obsidian/People/Sam Rivers.md', `${files.get('Obsidian/People/Sam Rivers.md')}\nMet at university.\n`);
  files.set('Obsidian/Chats/Google Messages/Alex Doe.md', 'All mine now.\n');
  const msgs = JSON.parse(files.get('conversations/Sam Rivers/messages.json'));
  msgs.messages.push(msg({ index: 6, timestamp: '2024-01-05 12:00', text: 'new one' }));
  files.set('conversations/Sam Rivers/messages.json', JSON.stringify(msgs));
  rows[0] = { ...rows[0], count: 101, last: '2024-02-05 12:00' };
  rows[10] = { ...rows[10], count: 11 };
  writes = [];
  await O.update(io, { rows, labels: LABELS, ...MONTHLY });
  check('a new message rewrites its month, not the others', writes.includes('Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers 2024-01.md') && files.get('Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers 2024-01.md').includes('new one') && !writes.includes('Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers 2023-12.md'), writes.join(', '));
  check('…nor other chats', !writes.some((p) => p.includes('/WhatsApp/') || p.includes('/Telegram/')), writes.join(', '));
  const person2 = files.get('Obsidian/People/Sam Rivers.md');
  check('your notes in a person note stay', person2.includes('Met at university.') && person2.includes('141 messages'), person2.slice(-120));
  check('a note whose "Your notes" line was taken out is yours: left alone', files.get('Obsidian/Chats/Google Messages/Alex Doe.md') === 'All mine now.\n');

  // A chat gone from the archive: its notes go, unless you wrote in them.
  files.set('Obsidian/Chats/WhatsApp/+1 555 010 0101.md', `${files.get('Obsidian/Chats/WhatsApp/+1 555 010 0101.md')}\nKeep this.\n`);
  removed = [];
  await O.update(io, { rows: rows.filter((r) => r.service !== 'whatsapp' && r.id !== 'gm-2'), labels: LABELS, ...MONTHLY });
  check('a removed chat\'s months go', removed.includes('Obsidian/Chats/WhatsApp/+1 555 010 0101/+1 555 010 0101 2024-02.md') && removed.includes('Obsidian/Chats/Google Messages/(555) 010-0102.md'), removed.join(', '));
  check('…but not a note you wrote in', files.has('Obsidian/Chats/WhatsApp/+1 555 010 0101.md') && !removed.includes('Obsidian/Chats/WhatsApp/+1 555 010 0101.md'));
  check('the status Settings shows', (await O.status(io)).notes > 10);

  // As it's written by default: a short chat's messages are in its own note,
  // a longer one's a note a year, a busy year's a note a month.
  removed = [];
  await O.update(io, { rows, labels: LABELS });
  const sam = files.get('Obsidian/Chats/Google Messages/Sam Rivers.md');
  check('a short chat: its messages in its own note', sam.includes('## Messages') && sam.includes('### Saturday, 30 December 2023') && sam.includes('![[conversations/Sam Rivers/media/2024-01-02 10.00 - Sam Rivers.jpg|320]]'), sam.slice(0, 300));
  check('…undated ones last, and your notes below them', sam.indexOf('### Undated') > sam.indexOf('new one') && sam.indexOf(O.MARK) > sam.indexOf('no date'));
  check('…and its month notes go', removed.includes('Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers 2024-01.md') && !files.has('Obsidian/Chats/Google Messages/Sam Rivers/Sam Rivers 2023-12.md'));
  const long = Array.from({ length: 150 }, (_, i) => msg({ index: i + 1, timestamp: `${i < 30 ? '2022-05' : i < 140 ? `2023-${String(1 + (i % 12)).padStart(2, '0')}` : '2024-02'}-0${1 + (i % 9)} 12:00`, text: `m${i}` }))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  files.set('conversations/72727/messages.json', JSON.stringify({ messages: long }));
  const r3 = rows.map((r) => (r.id === 'gm-4' ? { ...r, count: 150, first: long[0].timestamp, last: long[149].timestamp } : r));
  await O.update(io, { rows: r3, labels: LABELS, busyYear: 100 });
  const ad = 'Obsidian/Chats/Google Messages/72727';
  check('a longer chat: a note a year', files.has(`${ad}/72727 2022.md`) && files.has(`${ad}/72727 2024.md`) && files.get(`${ad}/72727 2022.md`).includes('year: 2022'));
  check('…a busy year, a note a month', files.has(`${ad}/72727 2023-01.md`) && files.has(`${ad}/72727 2023-12.md`) && !files.has(`${ad}/72727 2023.md`));
  check('…all listed in the chat note, newest first', files.get(`${ad}.md`).includes(`- [[${ad}/72727 2024|2024]] (10)\n- **2023**: [[${ad}/72727 2023-12|Dec]]`), files.get(`${ad}.md`).split('## Messages')[1]?.slice(0, 200));
  check('…and the years lead from one to the next', files.get(`${ad}/72727 2022.md`).includes(`[[${ad}/72727 2023-01|January 2023]] →`));
}

// ---------- a person at the centre ----------
// What a person's note says about them: moments that lead to their day in
// the messages, topics shared with others, who's named and who's in groups
// together, and what was shared.
{
  const files = new Map();
  let writes = [];
  const io = { readText: async (p) => (files.has(p) ? files.get(p) : null), write: async (p, d) => { files.set(p, String(d)); writes.push(p); }, remove: async (p) => { files.delete(p); } };
  const m = (o) => ({ direction: 'received', timestamp_precision: 'message', media: [], ...o });
  const pad = (n) => String(n).padStart(2, '0');
  const ana = [];
  const SAY = ['hiking near the lake this weekend?', 'yes, the lake trail', 'I saw Cleo there', 'hiking boots ready'];
  for (let d = 1; d <= 3; d++) for (let i = 0; i < 12; i++) ana.push(m({ index: ana.length + 1, timestamp: `2020-03-0${d} 10:${pad(i * 2)}`, direction: i % 2 ? 'sent' : 'received', sender: i % 2 ? 'Me' : 'Ana Lopez', text: SAY[i % 4] }));
  ana.push(m({ index: ana.length + 1, timestamp: '2021-06-10 21:00', text: 'look https://example.org/trail', media: [{ kind: 'image', file: 'media/lake.jpg' }] }));
  ana.push(m({ index: ana.length + 1, timestamp: '2021-06-10 21:05', kind: 'call', text: 'Missed call' }));
  const ben = ['hiking boots', 'the lake was cold', 'hiking again', 'lake swim', 'more hiking at the lake'].map((text, i) => m({ index: i + 1, timestamp: `2021-06-11 0${i}:00`, direction: i % 2 ? 'sent' : 'received', text }));
  const cleo = ['pottery class', 'pottery again', 'my pottery'].map((text, i) => m({ index: i + 1, timestamp: `2019-05-01 1${i}:00`, direction: i === 1 ? 'sent' : 'received', text }));
  // Someone you never wrote to: alerts, here about the same thing.
  const shop = ['hiking sale', 'hiking deals', 'more hiking'].map((text, i) => m({ index: i + 1, timestamp: `2021-06-12 0${i}:00`, text }));
  const R = [
    row({ id: 'gm-a', title: 'Ana Lopez', folder: 'conversations/Ana Lopez', contact: { people: [{ n: 'Ana Lopez', num: '5550100201', fav: 1, photo: 'conversations/Ana Lopez/contact/Ana Lopez.jpg',
      card: { key: 'k-ana', nickname: 'Annie', organization: 'Lakeside Co', job_title: 'Ranger', birthday: '--03-02', labels: ['Hiking club'], relations: [{ type: 'sister', name: 'Cleo Ward' }, { type: 'friend', name: 'Pat Q' }] } }] }, count: ana.length, first: ana[0].timestamp, last: '2021-06-10 21:05' }),
    row({ id: 'gm-b', title: 'Ben Carter', folder: 'conversations/Ben Carter', contact: { people: [{ n: 'Ben Carter', num: '5550100202', card: { key: 'k-ben', labels: ['Hiking club'] } }] }, count: ben.length, first: ben[0].timestamp, last: ben[4].timestamp }),
    row({ id: 'gm-c', title: 'Cleo Ward', folder: 'conversations/Cleo Ward', contact: { people: [{ n: 'Cleo Ward', num: '5550100203' }] }, count: 60, first: cleo[0].timestamp, last: cleo[2].timestamp }),
    row({ id: 'gm-s', title: '72000', folder: 'conversations/72000', count: shop.length, first: shop[0].timestamp, last: shop[2].timestamp }),
    row({ id: 'gm-g', title: 'Friends', folder: 'conversations/Friends', contact: { people: [{ n: 'Ana Lopez', num: '5550100201' }, { n: 'Ben Carter', num: '5550100202' }, { n: 'Cleo Ward', num: '5550100203' }] }, count: 0 }),
  ];
  for (const [r, list] of [[R[0], ana], [R[1], ben], [R[2], cleo], [R[3], shop], [R[4], []]]) files.set(`${r.folder}/messages.json`, JSON.stringify({ messages: list }));
  const r1 = await O.update(io, { rows: R });
  const a = files.get('Obsidian/People/Ana Lopez.md');
  const chat = 'Obsidian/Chats/Google Messages/Ana Lopez';
  check('a person note opens with the gist', a.includes('> [!summary]') && a.includes('You sent 49% of them.') && a.includes('You usually reply within 5 minutes'), a.slice(0, 600));
  check('…and who starts the conversations', a.includes('conversations: 4') && a.includes('they_start: 100'));
  check('moments lead to their day in the messages', a.includes(`- **First message**: [[${chat}#Sunday, 1 March 2020|1 March 2020]], from them`) && a.includes('- **Longest streak**: 3 days in a row') && a.includes(`- **Longest silence**: 1 year and 3 months, until [[${chat}#Thursday, 10 June 2021|10 June 2021]]`), a.split('## Moments')[1]?.slice(0, 600));
  check('the years, newest first, with a bar (a link\'s | escaped in the table)', a.includes(`| [[${chat}\\|2021]] | 1 |`) && a.indexOf('|2021]]') < a.indexOf('|2020]]') && a.includes('████'), a.split('## Over the years')[1]?.slice(0, 400));
  check('when you talk', a.includes('Mostly in the morning, busiest on Sundays.') || a.includes('Mostly in the morning, busiest on'), a.split('## When you talk')[1]?.slice(0, 200));
  check('a topic shared with someone else is a note that links them', a.includes('[[Obsidian/Topics/hiking|hiking]]') && files.get('Obsidian/Topics/hiking.md')?.includes('[[Obsidian/People/Ben Carter|Ben Carter]]'), a.split('Talks about')[1]?.slice(0, 200));
  check('…one only they talk about is just a word', files.get('Obsidian/People/Cleo Ward.md').includes('**Talks about** pottery') && !files.has('Obsidian/Topics/pottery.md'));
  check('who they name, and who names them', a.includes('**Named in your chats**: [[Obsidian/People/Cleo Ward|Cleo Ward]] (9)') && files.get('Obsidian/People/Cleo Ward.md').includes('**Named in chats with**: [[Obsidian/People/Ana Lopez|Ana Lopez]] (9)'));
  check('who they are in groups with', a.includes('**In groups with**: [[Obsidian/People/Ben Carter|Ben Carter]] (1 group), [[Obsidian/People/Cleo Ward|Cleo Ward]] (1 group)'), a.split('## Connections')[1]?.slice(0, 400));
  check('connections are properties too', a.includes('connections: ["[[Obsidian/People/Cleo Ward|Cleo Ward]]","[[Obsidian/People/Ben Carter|Ben Carter]]"]'), a.match(/connections: .*/)?.[0]);
  const ph = files.get('Obsidian/People/Ana Lopez/Ana Lopez photos.md') || '';
  const ln = files.get('Obsidian/People/Ana Lopez/Ana Lopez links.md') || '';
  check('their photos, under the day they were sent', ph.includes(`### [[${chat}#Thursday, 10 June 2021|10 June 2021]]`) && ph.includes('![[conversations/Ana Lopez/media/lake.jpg|320]]'), ph);
  check('their links, by site', ln.includes('## example.org (1)') && ln.includes('- https://example.org/trail · [['), ln);
  check('…both linked from the person, with the calls', a.includes('[[Obsidian/People/Ana Lopez/Ana Lopez photos|1 photo]] · [[Obsidian/People/Ana Lopez/Ana Lopez links|1 link]] · 1 call'));
  check('no photos, no photos note', !files.has('Obsidian/People/Ben Carter/Ben Carter photos.md'));
  const people = files.get('Obsidian/People.md');
  check('people: most recent, and those you lost touch with', people.indexOf('[[Obsidian/People/Ben Carter') < people.indexOf('[[Obsidian/People/Ana Lopez') && people.split('## Lost touch')[1]?.includes('Cleo Ward'), people);
  check('home and topics list the shared topics', files.get('Obsidian/Message Archivist.md').includes('[[Obsidian/Topics/hiking|hiking]]') && files.get('Obsidian/Topics.md')?.includes('[[Obsidian/Topics/lake|lake]]') && r1.topics === 2, String(r1.topics));
  check('from the phone\'s contacts: photo, starred, nickname, work, birthday, labels', a.includes('![[conversations/Ana Lopez/contact/Ana Lopez.jpg|120]]') && a.includes('⭐ Starred · “Annie” · Ranger at Lakeside Co · Birthday 2 March · [[Obsidian/Labels/Hiking club|Hiking club]]')
    && a.includes('starred: true') && a.includes('birthday: "--03-02"') && a.includes('tags: ["label/hiking-club"]') && a.includes('"Annie"'), a.slice(0, 900));
  check('a label is a note linking its people', files.get('Obsidian/Labels/Hiking club.md')?.includes('[[Obsidian/People/Ben Carter|Ben Carter]]') && files.get('Obsidian/Labels.md')?.includes('2 people') && r1.labels === 1);
  check('relations link to the person when they\'re in People', a.includes('- **In your contacts**: sister: [[Obsidian/People/Cleo Ward|Cleo Ward]], friend: Pat Q'));
  check('birthdays you were in touch on', a.includes(`- **Birthdays**: you were in touch on 1 of their 2 birthdays since you first were, most recently [[${chat}#Monday, 2 March 2020|2 March 2020]]`), a.split('## Moments')[1]?.slice(0, 900));
  {
    const bf = new Map(files);
    const bio = { readText: async (p) => (bf.has(p) ? bf.get(p) : null), write: async (p, d) => { bf.set(p, String(d)); } };
    await O.update(bio, { rows: R, full: true, book: { contacts: [{ key: 'kc', name: 'Cleo Ward', numbers: ['5550100203'], organization: 'Kiln Works', labels: ['Pottery'] }] } });
    const cl = bf.get('Obsidian/People/Cleo Ward.md') || '';
    check('a person note has what the address book knows', cl.includes('organization: "Kiln Works"') && cl.includes('[[Obsidian/Labels/Pottery|Pottery]]') && bf.has('Obsidian/Labels/Pottery.md'), cl.slice(0, 500));
  }
  const sh = files.get('Obsidian/People/72000.md') || '';
  check('someone you never wrote to is one-way: tagged, and said so', sh.includes('one_way: true') && sh.includes('tags: ["one-way"]') && sh.includes('never written to them') && r1.oneWay === 1, sh.slice(0, 400));
  check('…not in topics, though they use the same words', !files.get('Obsidian/Topics/hiking.md').includes('72000'));
  check('…nor among the most recent, but in a list of their own', !people.split('## A to Z')[0].includes('72000') && people.split('## One-way')[1]?.includes('[[Obsidian/People/72000|72000]]'));
  writes = [];
  await O.update(io, { rows: R });
  check('the analysis is kept: nothing changes, nothing is read or written', writes.length === 1, writes.join(', '));
  await O.update(io, { rows: R, small: 0, busyYear: 0 });
  check('a day in a month note is linked there', files.get('Obsidian/People/Ana Lopez.md').includes(`[[${chat}/Ana Lopez 2020-03#Sunday, 1 March 2020|1 March 2020]]`));
  check('what a chat says is counted without its calls', O.analyse(ana, null).sent === 18 && O.analyse(ana, null).calls === 1);
}

// ---------- days, events, photos and phrases ----------
// The calendar (a note a year and a month, each day linking to it in each
// chat), events found in the messages (birthdays, milestones, travel,
// meeting up, holidays, photo days), every photo by day, phrases as topics,
// a person's timeline and a group's gist. All names and texts are invented.
{
  const files = new Map();
  let writes = [];
  const io = { readText: async (p) => (files.has(p) ? files.get(p) : null), write: async (p, d) => { files.set(p, String(d)); writes.push(p); }, remove: async (p) => { files.delete(p); } };
  const m = (o) => ({ direction: 'received', timestamp_precision: 'message', media: [], ...o });
  const pad = (n) => String(n).padStart(2, '0');
  let ix = 0;
  const say = (list, ts, me, text, extra = {}) => list.push(m({ index: ++ix, timestamp: ts, direction: me ? 'sent' : 'received', sender: me ? 'Me' : 'X', text, ...extra }));
  const ana = [];
  for (const y of [2021, 2022, 2023]) {
    for (let w = 0; w < 12; w++) {
      say(ana, `${y}-${pad(1 + w)}-0${1 + (w % 9)} 18:00`, 0, 'did you set your fantasy football lineup', { sender: 'Ana Lopez' });
      say(ana, `${y}-${pad(1 + w)}-0${1 + (w % 9)} 18:05`, 1, 'yes, fantasy football league draft is next week');
    }
    say(ana, `${y}-05-04 09:00`, 1, 'Happy birthday!! 🎂');
    say(ana, `${y}-08-12 08:00`, 0, 'happy birthday to you!!', { sender: 'Ana Lopez' });
    say(ana, `${y}-12-25 10:00`, 1, 'Merry Christmas!');
  }
  say(ana, '2022-06-10 07:00', 0, 'Just landed in Lisbon', { sender: 'Ana Lopez' });
  say(ana, '2023-03-02 19:00', 0, 'We got engaged!!!', { sender: 'Ana Lopez' });
  say(ana, '2023-03-02 19:01', 1, 'Congratulations!!!');
  for (let i = 0; i < 7; i++) say(ana, `2023-07-15 14:0${i}`, 0, '', { sender: 'Ana Lopez', media: [{ kind: 'image', file: `media/2023-07-15 14.0${i} - Ana Lopez.jpg` }] });
  say(ana, '2023-09-09 18:00', 0, 'on my way, 10 min', { sender: 'Ana Lopez' });
  ana.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const ben = [];
  for (let i = 0; i < 8; i++) say(ben, `2023-0${1 + i}-1${i} 20:00`, i % 2, 'fantasy football trade talk', { sender: 'Ben Carter' });
  say(ben, '2023-08-12 09:00', 0, 'Happy bday!', { sender: 'Ben Carter' });
  ben.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const cleo = [];
  say(cleo, '2023-08-12 10:00', 0, 'Happy birthday!!!', { sender: 'Cleo Ward' });
  say(cleo, '2023-08-12 10:30', 1, 'thank you!');
  const grp = [];
  for (let i = 0; i < 24; i++) say(grp, `2023-12-${pad(1 + i)} 12:00`, i % 3 === 0, 'pottery night again?', i % 3 === 0 ? {} : { sender: i % 2 ? 'Ana Lopez' : 'Ben Carter', sender_number: i % 2 ? '5550100701' : '5550100702' });
  say(grp, '2023-12-28 09:00', 0, 'Happy birthday Cleo!', { sender: 'Ana Lopez', sender_number: '5550100701' });
  const shop = [];
  for (let i = 0; i < 3; i++) say(shop, `2023-08-0${1 + i} 08:00`, 0, 'Your code is 123456', { sender: '72000' });
  const rowOf = (id, title, folder, people, list) => ({ id, title, folder, contact: { people }, participants: ['Me'], count: list.length, first: list[0].timestamp, last: list[list.length - 1].timestamp });
  const R = [
    rowOf('gm-a', 'Ana Lopez', 'conversations/Ana Lopez', [{ n: 'Ana Lopez', num: '5550100701' }], ana),
    rowOf('gm-b', 'Ben Carter', 'conversations/Ben Carter', [{ n: 'Ben Carter', num: '5550100702' }], ben),
    rowOf('gm-c', 'Cleo Ward', 'conversations/Cleo Ward', [{ n: 'Cleo Ward', num: '5550100703' }], cleo),
    rowOf('gm-g', 'Ana Lopez, Ben Carter', 'conversations/Ana Lopez, Ben Carter', [{ n: 'Ana Lopez', num: '5550100701' }, { n: 'Ben Carter', num: '5550100702' }], grp),
    rowOf('gm-s', '72000', 'conversations/72000', [], shop),
  ];
  for (const [r, list] of [[R[0], ana], [R[1], ben], [R[2], cleo], [R[3], grp], [R[4], shop]]) files.set(`${r.folder}/messages.json`, JSON.stringify({ messages: list }));
  const ev = O.analyse([...ana, ...grp].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), null).events;
  const has = (kind, day, me, hint) => ev.some(([dn, k, w, h]) => k === kind && new Date(dn * 864e5).toISOString().slice(0, 10) === day && (me == null || w === me) && (hint == null || h === hint));
  check('events: a birthday wish, and who said it', has('bday', '2021-05-04', 1, '') && has('bday', '2022-08-12', 0, ''));
  check('…congratulations, and what for', has('congrats', '2023-03-02', 1, 'engagement'));
  check('…travel, with the place', has('trip', '2022-06-10', 0, 'Lisbon'));
  check('…meeting up, and holidays', has('meet', '2023-09-09', 0) && has('holiday', '2023-12-25', 1, 'Christmas'));
  check('…a birthday in a group, for whom', has('bday', '2023-12-28', 0, 'Cleo'));

  const r1 = await O.update(io, { rows: R });
  const ana1 = files.get('Obsidian/People/Ana Lopez.md') || '';
  const chat = 'Obsidian/Chats/Google Messages/Ana Lopez';
  check('a phrase shared by two people is a topic', files.get('Obsidian/Topics/fantasy football.md')?.includes('[[Obsidian/People/Ben Carter|Ben Carter]]') && ana1.includes('> **Phrases** ') && ana1.includes('[[Obsidian/Topics/fantasy football|fantasy football]]'), ana1.match(/\*\*Phrases\*\*.*/)?.[0]);
  check('…without its longer variants', !ana1.match(/\*\*Phrases\*\*.*/)?.[0].includes('fantasy football league'), ana1.match(/\*\*Phrases\*\*.*/)?.[0]);
  const topic = files.get('Obsidian/Topics/fantasy football.md') || '';
  check('a topic note: who, how often, first, last and the day most', topic.includes('| [[Obsidian/People/Ana Lopez\\|Ana Lopez]] | 72 |') && topic.includes(`[[${chat}#Friday, 1 January 2021\\|1 January 2021]]`) && topic.includes('first: 2021-01-01'), topic);
  const aug = files.get('Obsidian/Calendar/2023/2023-08.md') || '';
  check('a month note: each day, linked to it in each chat', aug.includes('## Saturday, 12 August 2023') && aug.includes('[[Obsidian/Chats/Google Messages/Cleo Ward#Saturday, 12 August 2023|Cleo Ward]] 2'), aug);
  check('…and its events, one line for the same thing on one day', aug.includes('[[Obsidian/People/Ana Lopez|Ana Lopez]], [[Obsidian/People/Ben Carter|Ben Carter]] and [[Obsidian/People/Cleo Ward|Cleo Ward]] wished you happy birthday'));
  check('…but not senders you never wrote to', !aug.includes('72000') && !aug.includes('Saturday, 1 August 2023'));
  const y23 = files.get('Obsidian/Calendar/2023.md') || '';
  check('a year note: months, people of the year, what was talked about', y23.includes('| [[Obsidian/Calendar/2023/2023-08\\|August]] |') && y23.includes('## People of the year') && y23.includes('## Talked about') && y23.includes('pottery'), y23.slice(0, 1200));
  check('the calendar lists the years', files.get('Obsidian/Calendar.md')?.includes('| [[Obsidian/Calendar/2023\\|2023]] |'));
  const evs = files.get('Obsidian/Events.md') || '';
  check('events: your birthday, from who wished you happy birthday', evs.includes('Probably 12 August, going by who wished you happy birthday on it: 3 people in 2023, 1 in 2022, 1 in 2021.'), evs.split('## Birthdays')[0].slice(-300));
  check('…a birthday calendar: from your wishes, and from a group\'s', evs.includes('- **4 May**: [[Obsidian/People/Ana Lopez|Ana Lopez]] *(probably)*') && evs.includes('- **28 December**: [[Obsidian/People/Cleo Ward|Cleo Ward]] *(maybe)*'), evs.split('## Milestones')[0]);
  check('…milestones, travel and meeting up', evs.includes('You congratulated [[Obsidian/People/Ana Lopez|Ana Lopez]] (engagement?)') && evs.includes('Travel talk with [[Obsidian/People/Ana Lopez|Ana Lopez]] · Lisbon') && evs.includes('## Meeting up'));
  const ph = files.get('Obsidian/Photos/2023 photos.md') || '';
  check('photos: by day, from every chat, small and side by side', ph.includes('## Saturday, 15 July 2023') && ph.includes('![[conversations/Ana Lopez/media/2023-07-15 14.00 - Ana Lopez.jpg|200]] ![[conversations/Ana Lopez/media/2023-07-15 14.01 - Ana Lopez.jpg|200]]'), ph.slice(0, 600));
  check('…and the calendar day links to them', files.get('Obsidian/Calendar/2023/2023-07.md')?.includes('📷 [[Obsidian/Photos/2023 photos#Saturday, 15 July 2023|7]]'));
  const tl = files.get('Obsidian/People/Ana Lopez/Ana Lopez timeline.md') || '';
  check('a person\'s timeline, year by year', tl.includes('## [[Obsidian/Calendar/2023|2023]]') && tl.includes('🎉 You congratulated them (engagement?)') && tl.includes('👋 First message, from them') && tl.indexOf('## [[Obsidian/Calendar/2023') < tl.indexOf('## [[Obsidian/Calendar/2021'), tl.slice(0, 800));
  check('…linked from their note, with their events', ana1.includes('[[Obsidian/People/Ana Lopez/Ana Lopez timeline|Ana Lopez timeline]]') && ana1.includes('## Events') && ana1.includes('- **Birthday**: probably 4 May'));
  check('their birthday from a group\'s wishes is on their timeline', files.get('Obsidian/People/Cleo Ward/Cleo Ward timeline.md')?.includes('Birthday wishes for them in [[Obsidian/Chats/Google Messages/Ana Lopez, Ben Carter|Ana Lopez, Ben Carter]]'));
  const g = files.get('Obsidian/Chats/Google Messages/Ana Lopez, Ben Carter.md') || '';
  check('a group\'s gist: who talks most, and its events', g.includes('> **Most active**: [[Obsidian/People/Ana Lopez|Ana Lopez]] 36% · You 32% · [[Obsidian/People/Ben Carter|Ben Carter]] 32%') && g.includes('> **Events**: 🎂 1'), g.slice(0, 900));
  check('the home note leads everywhere', files.get('Obsidian/Message Archivist.md')?.includes('**Start here**: [[Obsidian/People|People]] · [[Obsidian/Calendar|Calendar]] · [[Obsidian/Events|Events]] · [[Obsidian/Photos|Photos]] · [[Obsidian/Topics|Topics]]'));
  check('the report counts the events', r1.events > 10, String(r1.events));
  // Your own writing in a month note stays; nothing new, nothing written.
  files.set('Obsidian/Calendar/2023/2023-08.md', `${aug}\nThe week at the lake.\n`);
  writes = [];
  await O.update(io, { rows: R });
  check('your notes in a month note stay, and nothing else is written', files.get('Obsidian/Calendar/2023/2023-08.md').includes('The week at the lake.') && writes.length === 1, writes.join(', '));
  // A manifest of another version: everything is written again, and notes
  // no longer made still go, but not one you wrote in.
  const man = JSON.parse(files.get(O.MANIFEST));
  man.version = O.VERSION - 1;
  files.set(O.MANIFEST, JSON.stringify(man));
  files.set('Obsidian/People/Ben Carter.md', `${files.get('Obsidian/People/Ben Carter.md')}\nKeep me.\n`);
  const r9 = await O.update(io, { rows: R.filter((r) => r.id !== 'gm-b' && r.id !== 'gm-c') });
  check('a manifest of another version: notes no longer made still go, yours stay', !files.has('Obsidian/People/Cleo Ward.md') && files.get('Obsidian/People/Ben Carter.md')?.includes('Keep me.') && r9.removed > 0 && r9.kept === 1 && r9.written > 10, JSON.stringify(r9));
  check('month notes count as yours for "Delete the notes"', O.ownable('Obsidian/Calendar/2023/2023-08.md') && O.ownable('Obsidian/Calendar/2023.md') && O.ownable('Obsidian/Topics/fantasy football.md') && !O.ownable('Obsidian/Photos/2023 photos.md'));
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
