// Checks the viewer's graph model (GMGraph, extension/graph.js) on a small
// invented archive: the nodes and links it builds from the chats (people,
// topics, groups, years, labels, you), the ego graph round a focus (caps,
// depth, filters), the deterministic layout, each kind of profile and the
// search. All names, numbers and texts here are invented.
// node test/graph/run.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const EXT = 'extension';
// The library, the app modules (each app's name and how its people are known), and the graph.
for (const f of ['library.js', ...readdirSync(join(EXT, 'modules')).filter((f) => f.endsWith('.js')).sort().map((f) => `modules/${f}`), 'graph.js']) new Function(readFileSync(join(EXT, f), 'utf8'))();
const G = globalThis.GMLib;
const GG = globalThis.GMGraph;

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failed++; };
const J = JSON.stringify;
const ids = (list) => list.map((n) => n.id).sort().join(' ');

// ---------- the invented archive ----------
// Records as messages.json has them (the viewer's compact messages read the
// same: test/people/run.mjs checks that). Ana: three March days of hiking
// talk naming Cleo, birthday and Christmas wishes, a link and a photo, "on
// my way" and a call. Ben: a day of hiking. Cleo: pottery, her own topic.
// 72000: a shop you never wrote to, about hiking too. Friends: a group of
// the three, where Ana wishes Cleo happy birthday.
const m = (o) => ({ direction: 'received', timestamp_precision: 'message', media: [], ...o });
const pad = (n) => String(n).padStart(2, '0');
const byTime = (a, b) => a.timestamp.localeCompare(b.timestamp);
const ana = [];
const SAY = ['hiking near the lake this weekend?', 'yes, the lake trail', 'I saw Cleo there', 'hiking boots ready'];
for (let d = 1; d <= 3; d++) for (let i = 0; i < 12; i++) ana.push(m({ index: ana.length + 1, timestamp: `2020-03-0${d} 10:${pad(i * 2)}`, direction: i % 2 ? 'sent' : 'received', sender: i % 2 ? 'Me' : 'Ana Lopez', text: SAY[i % 4] }));
ana.push(m({ index: 101, timestamp: '2020-03-02 09:00', direction: 'sent', sender: 'Me', text: 'Happy birthday!! 🎂' }));
ana.push(m({ index: 102, timestamp: '2020-08-12 08:00', sender: 'Ana Lopez', text: 'happy birthday to you!!' }));
ana.push(m({ index: 103, timestamp: '2020-12-25 10:00', direction: 'sent', sender: 'Me', text: 'Merry Christmas!' }));
ana.push(m({ index: 104, timestamp: '2021-06-10 21:00', sender: 'Ana Lopez', text: 'look https://example.org/trail', media: [{ kind: 'image', file: 'media/lake.jpg' }] }));
ana.push(m({ index: 105, timestamp: '2021-06-10 21:03', sender: 'Ana Lopez', text: 'on my way' }));
ana.push(m({ index: 106, timestamp: '2021-06-10 21:05', sender: 'Ana Lopez', kind: 'call', text: 'Missed call' }));
ana.sort(byTime);
const ben = ['hiking boots', 'the lake was cold', 'hiking again', 'lake swim', 'more hiking at the lake'].map((text, i) => m({ index: i + 1, timestamp: `2021-06-11 0${i}:00`, direction: i % 2 ? 'sent' : 'received', sender: i % 2 ? 'Me' : 'Ben Carter', text }));
ben.push(m({ index: 9, timestamp: '2021-08-12 09:00', sender: 'Ben Carter', text: 'happy birthday!!' }));
const cleo = ['pottery class', 'pottery again', 'my pottery'].map((text, i) => m({ index: i + 1, timestamp: `2019-05-01 1${i}:00`, direction: i === 1 ? 'sent' : 'received', sender: i === 1 ? 'Me' : 'Cleo Ward', text }));
cleo.push(m({ index: 9, timestamp: '2019-08-12 09:00', sender: 'Cleo Ward', text: 'Happy birthday!!!' }));
const shop = ['hiking sale', 'hiking deals', 'more hiking'].map((text, i) => m({ index: i + 1, timestamp: `2021-06-12 0${i}:00`, sender: '72000', text }));
const A = { sender: 'Ana Lopez', sender_number: '5550100201' };
const B = { sender: 'Ben Carter', sender_number: '5550100202' };
const friends = [
  m({ index: 1, timestamp: '2021-07-03 18:00', ...A, text: 'game night saturday?' }),
  m({ index: 2, timestamp: '2021-07-03 18:05', direction: 'sent', sender: 'Me', text: 'yes, game night' }),
  m({ index: 3, timestamp: '2021-07-03 18:10', ...B, text: 'game night it is' }),
  m({ index: 4, timestamp: '2021-07-07 09:00', ...A, text: 'Happy birthday Cleo!' }),
];
const row = (ci, id, title, people, messages, more = {}) => ({ ci, id, title, folder: `conversations/${title}`, contact: people ? { people } : undefined, messages, first: messages[0]?.timestamp, last: messages[messages.length - 1]?.timestamp, ...more });
const anaCard = { key: 'k-ana', nickname: 'Annie', organization: 'Lakeside Co', job_title: 'Ranger', birthday: '--03-02', labels: ['Hiking club'], relations: [{ type: 'sister', name: 'Cleo Ward' }, { type: 'friend', name: 'Pat Q' }] };
const ROWS = [
  row(0, 'gm-a', 'Ana Lopez', [{ n: 'Ana Lopez', num: '5550100201', fav: 1, photo: 'conversations/Ana Lopez/contact/Ana Lopez.jpg', card: anaCard }], ana),
  row(1, 'gm-b', 'Ben Carter', [{ n: 'Ben Carter', num: '5550100202', card: { key: 'k-ben', labels: ['Hiking club'] } }], ben),
  row(2, 'gm-c', 'Cleo Ward', [{ n: 'Cleo Ward', num: '5550100203' }], cleo),
  row(3, 'gm-s', '72000', null, shop),
  row(4, 'gm-g', 'Friends', [{ n: 'Ana Lopez', num: '5550100201' }, { n: 'Ben Carter', num: '5550100202' }, { n: 'Cleo Ward', num: '5550100203' }], friends),
];
// The phone's address book: Cleo is a contact with a label of her own.
const BOOK = { contacts: [{ key: 'kc', name: 'Cleo Ward', numbers: ['5550100203'], labels: ['Pottery'] }] };
const P = G.people(ROWS, null, BOOK);
const cache = new Map();
const graph = GG.build({ rows: ROWS, P, cache, book: BOOK });
const ANA = 'person:gm-a';
const BEN = 'person:gm-b';
const CLEO = 'person:gm-c';
const SHOP = 'person:gm-s';
const edge = (kind, a, b) => graph.edges.find((e) => e.kind === kind && ((e.a === a && e.b === b) || (!e.dir && e.a === b && e.b === a)));

// ---------- build ----------
{
  check('the module and its constants', J(GG.TYPES) === '["you","person","topic","group","year","label"]' && J(GG.CAPS) === '{"person":14,"topic":10,"group":6,"year":12,"label":6}');
  check('a row without an analysis is analysed into the cache', cache.size === 5 && cache.get(ROWS[0]).sent === 20);
  const you = graph.nodes.get('you');
  check('you: a node with the two-way messages as weight', you?.type === 'you' && you.label === 'You' && you.w === 51 && J(graph.byType.you) === '["you"]', J(you));
  const a = graph.nodes.get(ANA);
  check('a person: id from their key, label their name, weight their messages, their number under it', a?.type === 'person' && a.key === 'gm-a' && a.label === 'Ana Lopez' && a.w === 41 && a.sub === '(555) 010-0201' && a.oneWay === false && a.ref === P.byChat.get('gm-a') && J(a.services) === '["sms"]', J({ ...a, ref: undefined }));
  const t = graph.nodes.get('topic:hiking');
  check('a topic two people share: uses and users', t?.type === 'topic' && t.key === 'hiking' && t.label === 'hiking' && t.w === 21 && t.people === 2 && t.phrase === false && graph.nodes.has('topic:lake'), J(t));
  check('a word only one person uses is no topic', !graph.nodes.has('topic:pottery') && !graph.edges.some((e) => e.b === 'topic:pottery' || e.a === 'topic:pottery'));
  const g = graph.nodes.get('group:gm-g');
  check('a group: its chat key, title, messages, app and row', g?.type === 'group' && g.key === 'gm-g' && g.label === 'Friends' && g.w === 4 && g.service === 'sms' && g.ref === ROWS[4] && g.ref.ci === 4, J({ ...g, ref: undefined }));
  const y = graph.nodes.get('year:2020');
  check('a year: the messages of every two-way chat that year', y?.type === 'year' && y.key === '2020' && y.label === '2020' && y.w === 39 && graph.nodes.get('year:2019')?.w === 4 && graph.nodes.get('year:2021')?.w === 12, J([y, graph.nodes.get('year:2019'), graph.nodes.get('year:2021')]));
  const l = graph.nodes.get('label:Hiking club');
  check('a label from the contacts: how many have it', l?.type === 'label' && l.key === 'Hiking club' && l.w === 2 && graph.nodes.get('label:Pottery')?.w === 1, J(l));
  check('every id is type:key', [...graph.nodes.values()].every((n) => n.id === (n.type === 'you' ? 'you' : `${n.type}:${n.key}`)));
  check('byType lists each type, heaviest first', J(graph.byType.person) === J([ANA, BEN, CLEO, SHOP]) && J(graph.byType.year) === '["year:2020","year:2021","year:2019"]' && graph.byType.topic.length === 2 && graph.byType.group.length === 1 && graph.byType.label.length === 2, J(graph.byType));
  check('talks: each person to the topic they share, you to it with the total', edge('talks', ANA, 'topic:hiking')?.w === 18 && edge('talks', BEN, 'topic:hiking')?.w === 3 && edge('talks', 'you', 'topic:hiking')?.w === 21 && !graph.edges.some((e) => e.kind === 'talks' && e.a === CLEO));
  const named = graph.edges.filter((e) => e.kind === 'named');
  check('named: Ana names Cleo in your chats, with the direction', named.length === 1 && named[0].a === ANA && named[0].b === CLEO && named[0].dir === true && named[0].w === 9, J(named));
  check('member: each of the group, weighed by what they said, and you', edge('member', ANA, 'group:gm-g')?.w === 2 && edge('member', BEN, 'group:gm-g')?.w === 1 && edge('member', CLEO, 'group:gm-g')?.w === 1 && edge('member', 'you', 'group:gm-g')?.w === 4);
  const together = graph.edges.filter((e) => e.kind === 'together');
  check('together: every pair in the group, once', together.length === 3 && edge('together', ANA, BEN)?.w === 1 && edge('together', CLEO, ANA)?.w === 1 && edge('together', BEN, CLEO)?.w === 1, J(together));
  check('active: people, the group and you to their years', edge('active', ANA, 'year:2020')?.w === 39 && edge('active', ANA, 'year:2021')?.w === 2 && edge('active', CLEO, 'year:2019')?.w === 4 && edge('active', 'group:gm-g', 'year:2021')?.w === 4 && edge('active', 'you', 'year:2021')?.w === 12 && edge('active', SHOP, 'year:2021')?.w === 3);
  check('label: from a chat\'s card and from the address book', !!edge('label', ANA, 'label:Hiking club') && !!edge('label', BEN, 'label:Hiking club') && !!edge('label', CLEO, 'label:Pottery') && edge('label', 'you', 'label:Hiking club')?.w === 2);
  const rel = graph.edges.filter((e) => e.kind === 'relation');
  check('relation: a contact\'s relation resolved by name; one that isn\'t anyone makes no edge', rel.length === 1 && rel[0].a === ANA && rel[0].b === CLEO && rel[0].type === 'sister', J(rel));
  check('chat: you to everyone, one-way senders too', edge('chat', 'you', ANA)?.w === 41 && edge('chat', 'you', SHOP)?.w === 3 && graph.edges.filter((e) => e.kind === 'chat').length === 4);
  check('the edges add up, and adj has each at both ends', graph.edges.length === 33 && graph.adj.get(ANA).length === 11 && graph.adj.get('topic:hiking').length === 3, `${graph.edges.length} ${graph.adj.get(ANA).length} ${graph.adj.get('topic:hiking').length}`);
  check('a sender you never wrote to is one-way', graph.oneWay.size === 1 && graph.oneWay.has(SHOP) && graph.nodes.get(SHOP).oneWay === true);
  const E = graph.events;
  check('events as the notes find them, in order, with the person as a node', E.length === 7 && E.map((e) => `${e.d} ${e.kind} ${e.me}`).join(', ') === '2019-08-12 bday 0, 2020-03-02 bday 1, 2020-08-12 bday 0, 2020-12-25 holiday 1, 2021-06-10 meet 0, 2021-07-07 bday 0, 2021-08-12 bday 0' && E[1].person === graph.nodes.get(ANA) && E[1].row === ROWS[0] && E[3].hint === 'Christmas', E.map((e) => `${e.d} ${e.kind} ${e.me}`).join(', '));
  check('…a group\'s wishes by first name are that person\'s', E[5].person === null && E[5].for === graph.nodes.get(CLEO) && E[5].hint === 'Cleo' && graph.byPerson.get(CLEO)?.length === 2 && graph.byPerson.get(ANA)?.length === 4);
  check('…but not a one-way sender\'s', !E.some((e) => e.row === ROWS[3]));
  check('birthdays: from the contacts, or maybe from a group\'s wishes', graph.birthdays.get(ANA)?.how === 'contacts' && graph.birthdays.get(ANA).md === '03-02' && graph.birthdays.get(CLEO)?.how === 'maybe' && graph.birthdays.get(CLEO).md === '07-07' && graph.birthdays.get(CLEO).text === '7 July' && J(graph.birthdays.get(CLEO).years) === '["2021"]' && !graph.birthdays.has(BEN), J([...graph.birthdays]));
  check('your birthday: the day three people wished you happy birthday', graph.mine?.md === '08-12' && graph.mine.text === '12 August' && graph.mine.total === 3 && J(graph.mine.years) === '[["2021",1],["2020",1],["2019",1]]', J(graph.mine));
  check('build is deterministic', J([...GG.build({ rows: ROWS, P, cache, book: BOOK }).edges]) === J(graph.edges));
  check('without P or a cache, build makes its own', GG.build({ rows: ROWS, book: BOOK }).nodes.size === graph.nodes.size);
}

// ---------- ego ----------
{
  const you = GG.ego(graph, 'you');
  check('focus you, one step: everyone you wrote to, every topic, group, year and label', you.focus.id === 'you' && you.depth === 1 && you.nodes.length === 12 && you.nodes[0].ring === 0 && you.nodes.slice(1).every((n) => n.ring === 1) && !you.nodes.some((n) => n.id === SHOP), ids(you.nodes));
  check('…nothing hidden, and each neighbour carries its link weight', Object.values(you.hidden).every((n) => n === 0) && you.nodes.find((n) => n.id === ANA).link === 41 && you.nodes.find((n) => n.id === 'year:2021').link === 12, J(you.hidden));
  check('…ring 1 in sector order, heaviest first', you.nodes.slice(1).map((n) => n.id).join(' ') === `${ANA} ${BEN} ${CLEO} topic:hiking topic:lake group:gm-g year:2020 year:2021 year:2019 label:Hiking club label:Pottery`, you.nodes.slice(1).map((n) => n.id).join(' '));
  check('…its edges are those between the nodes shown', you.edges.length === graph.edges.filter((e) => e.a !== SHOP && e.b !== SHOP).length && you.edges.every((e) => you.nodes.some((n) => n.id === e.a) && you.nodes.some((n) => n.id === e.b)));
  const ow = GG.ego(graph, 'you', { oneWay: true });
  check('one-way senders on request', ow.nodes.length === 13 && ow.nodes.some((n) => n.id === SHOP && n.oneWay));
  const a1 = GG.ego(graph, ANA);
  check('focus a person, one step: topics, connections, group, years, label; never you', ids(a1.nodes) === ids([ANA, BEN, CLEO, 'topic:hiking', 'topic:lake', 'group:gm-g', 'year:2020', 'year:2021', 'label:Hiking club'].map((id) => ({ id }))), ids(a1.nodes));
  check('…the heaviest link counts when there are several', a1.nodes.find((n) => n.id === CLEO).link === 9 && a1.nodes.find((n) => n.id === BEN).link === 1);
  const a2 = GG.ego(graph, ANA, { depth: 2 });
  const r2 = a2.nodes.filter((n) => n.ring === 2);
  check('two steps: what links to the neighbours, with the way in', a2.depth === 2 && a2.nodes.length === 11 && ids(r2) === 'label:Pottery year:2019' && r2.every((n) => n.via === CLEO) && r2.find((n) => n.id === 'year:2019').link === 4, J(r2.map((n) => [n.id, n.via, n.link])));
  check('…one-way senders stay out of ring 2 too', !a2.nodes.some((n) => n.id === SHOP) && GG.ego(graph, ANA, { depth: 2, oneWay: true }).nodes.some((n) => n.id === SHOP && n.via === 'year:2021'));
  const topicsOnly = GG.ego(graph, ANA, { types: new Set(['topic']) });
  check('types: only the kinds asked for, the focus always', ids(topicsOnly.nodes) === `${ANA} topic:hiking topic:lake` && topicsOnly.edges.length === 2 && GG.ego(graph, ANA, { types: ['year'] }).nodes.length === 3);
  const apps = GG.ego(graph, 'you', { services: new Set(['whatsapp']) });
  check('services: people and groups of other apps go, the rest stays', !apps.nodes.some((n) => n.type === 'person' || n.type === 'group') && apps.nodes.length === 8, ids(apps.nodes));
  check('focus a topic: who talks about it', ids(GG.ego(graph, 'topic:hiking').nodes) === `${ANA} ${BEN} topic:hiking` && GG.ego(graph, 'topic:hiking').edges.length === 3);
  check('focus a year: its people and groups (one-way on request)', ids(GG.ego(graph, 'year:2021').nodes) === `group:gm-g ${ANA} ${BEN} year:2021` && GG.ego(graph, 'year:2021', { oneWay: true }).nodes.length === 5);
  check('focus a group: its members and years', ids(GG.ego(graph, 'group:gm-g').nodes) === `group:gm-g ${ANA} ${BEN} ${CLEO} year:2021`);
  check('focus a label: its people', ids(GG.ego(graph, 'label:Hiking club').nodes) === `label:Hiking club ${ANA} ${BEN}`);
  let threw = false;
  try { GG.ego(graph, 'person:nobody'); } catch { threw = true; }
  check('an unknown id throws', threw);
  check('the graph\'s nodes are not changed by an ego', !('ring' in graph.nodes.get(ANA)) && !('link' in graph.nodes.get(ANA)));

  // Caps: twenty people you wrote to, fourteen shown.
  const many = Array.from({ length: 20 }, (_, i) => {
    const k = i + 1;
    const msgs = Array.from({ length: k }, (_, j) => m({ index: j + 1, timestamp: `2022-01-${pad(1 + (j % 28))} 10:00`, sender: `Person ${pad(k)}`, text: 'see you there' }));
    msgs.push(m({ index: 99, timestamp: '2022-02-01 10:00', direction: 'sent', sender: 'Me', text: 'sure' }));
    return row(i, `c${pad(k)}`, `Person ${pad(k)}`, [{ n: `Person ${pad(k)}`, num: `55501010${pad(k)}` }], msgs);
  });
  const big = GG.build({ rows: many });
  const e = GG.ego(big, 'you');
  const shown = e.nodes.filter((n) => n.type === 'person');
  check('caps: the fourteen heaviest people, the rest counted as hidden', shown.length === GG.CAPS.person && e.hidden.person === 6 && shown.every((n) => n.w >= 8) && e.nodes.length === 16, J(e.hidden));
  check('…none of the other types is hidden', e.hidden.year === 0 && e.hidden.topic === 0);

  // ---------- layout ----------
  const L1 = GG.layout(you, { width: 900, height: 600 });
  check('layout is deterministic', J(L1) === J(GG.layout(GG.ego(graph, 'you'), { width: 900, height: 600 })) && J(L1) === J(GG.layout(GG.ego(GG.build({ rows: ROWS, P, cache: new Map(), book: BOOK }), 'you'), { width: 900, height: 600 })));
  check('the box and the centre', L1.width === 900 && L1.height === 600 && L1.cx === 450 && L1.cy === 300);
  const f = L1.nodes.find((n) => n.id === 'you');
  check('the focus at the centre, ring 0', f && f.x === 450 && f.y === 300 && f.ring === 0 && f.r === 26, J(f));
  const inBox = (lay) => lay.nodes.every((n) => n.x - n.r >= 0 && n.x + n.r <= lay.width && n.y - n.r >= 0 && n.y + n.r <= lay.height);
  check('every node within the box', inBox(L1) && L1.nodes.length === you.nodes.length);
  const apart = (lay, ring) => { const ns = lay.nodes.filter((n) => n.ring === ring); return ns.every((p, i) => ns.slice(i + 1).every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= p.r + q.r)); };
  check('ring-1 neighbours no closer than their radii', apart(L1, 1));
  const dist = (n) => Math.hypot(n.x - L1.cx, n.y - L1.cy);
  const R = L1.nodes.filter((n) => n.ring === 1).map(dist);
  check('ring 1 is a circle round the focus', Math.max(...R) - Math.min(...R) < 0.3 && Math.min(...R) > f.r + 22, J(R));
  // Sectors: going round from the top, the types come in TYPES order (one wrap at most).
  const sectorOrder = (lay, eg) => {
    const byId = new Map(eg.nodes.map((n) => [n.id, n]));
    const ring = lay.nodes.filter((n) => n.ring === 1).map((n) => ({ ...n, type: byId.get(n.id).type, th: ((Math.atan2(n.y - lay.cy, n.x - lay.cx) + Math.PI / 2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) })).sort((a, b) => a.th - b.th);
    const idx = ring.map((n) => GG.TYPES.indexOf(n.type));
    const drops = idx.filter((v, i) => idx[(i + 1) % idx.length] < v).length;
    return { ok: drops <= 1 && idx[0] === 1, seq: ring.map((n) => n.type).join(' ') };
  };
  const so = sectorOrder(L1, you);
  check('sectors in order: people, topics, groups, years, labels, from the top clockwise', so.ok, so.seq);
  check('edges carry both ends\' coordinates, a width and the direction', L1.edges.length === you.edges.length && L1.edges.every((e) => e.x1 != null && e.y2 != null && e.sw >= 1 && e.sw <= 3.5 && typeof e.dir === 'boolean') && L1.edges.find((e) => e.kind === 'named').dir === true && L1.edges.find((e) => e.kind === 'chat' && e.b === ANA).sw === 3.5);
  const L2 = GG.layout(a2, { width: 900, height: 600 });
  const outer = L2.nodes.filter((n) => n.ring === 2);
  check('two steps: ring 2 outside ring 1, within the box, each beside its way in', outer.length === 2 && inBox(L2) && outer.every((n) => Math.hypot(n.x - L2.cx, n.y - L2.cy) > Math.max(...L2.nodes.filter((x) => x.ring === 1).map((x) => Math.hypot(x.x - L2.cx, x.y - L2.cy))) + 5) && apart(L2, 2)
    && outer.every((n) => { const v = L2.nodes.find((x) => x.id === CLEO); return Math.hypot(n.x - v.x, n.y - v.y) < 120; }), J(outer));
  const small = GG.layout(GG.ego(big, 'you'), { width: 360, height: 320 });
  check('the viewer\'s smallest stage: fifteen neighbours still fit, apart', inBox(small) && apart(small, 1) && small.nodes.length === 16);
  const wide = GG.layout(GG.ego(big, 'you', { depth: 2 }), { width: 1400, height: 500 });
  check('a wide box: everything inside', inBox(wide));
  // A crowded small stage: fourteen people and ten topics with long words. The
  // ring must close (no node carried past a full turn onto the first ones) and
  // every pill the viewer draws must stay inside the box.
  {
    const crowd = { focus: { id: 'you', type: 'you' }, depth: 1, edges: [], hidden: {}, nodes: [{ id: 'you', type: 'you', ring: 0 },
      ...Array.from({ length: 14 }, (_, i) => ({ id: `person:p${pad(i)}`, type: 'person', label: `Person ${pad(i)}`, ring: 1, link: 40 - i })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `topic:t${i}`, type: 'topic', label: `a rather long phrase ${i}`, ring: 1, link: 20 - i }))] };
    const lay = GG.layout(crowd, { width: 360, height: 320 });
    const turn = (n) => (((Math.atan2(n.y - lay.cy, n.x - lay.cx) + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const placed = crowd.nodes.slice(1).map((n) => lay.nodes.find((x) => x.id === n.id));
    // Going round the ring, the nodes come in the order they were placed: nothing
    // carried past a full turn, nothing swapped with a neighbour.
    const angles = placed.map(turn);
    const round = angles.map((a, i) => [a, i]).sort((x, y) => x[0] - y[0]).map(([, i]) => i);
    const from = round.indexOf(0);
    const seq = [...round.slice(from), ...round.slice(0, from)];
    check('a crowded small stage: the ring closes, its order kept', seq.every((v, i) => v === i), J(seq));
    const pill = (n) => (Math.min(24, n.label.length) * 6.6 + 18) / 2;
    const out = crowd.nodes.filter((n) => n.type === 'topic').map((n) => [n, lay.nodes.find((x) => x.id === n.id)]).filter(([n, p]) => p.x - pill(n) < 0 || p.x + pill(n) > lay.width);
    check('…and every topic pill inside the box', !out.length, J(out.map(([n, p]) => [n.id, p.x, pill(n)])));
  }
  check('a focus alone', GG.layout(GG.ego(graph, SHOP, { types: ['topic'] }), { width: 400, height: 400 }).nodes.length === 1);
}

// ---------- profile ----------
{
  const pr = GG.profile(graph, ANA);
  const t = pr.totals;
  check('a person: who', pr.type === 'person' && pr.node === graph.nodes.get(ANA) && pr.p === P.byChat.get('gm-a') && pr.oneWay === false && J(pr.ids) === '["tel:5550100201","contact:k-ana"]' && J(pr.labels) === '["Hiking club"]');
  check('…the gist: messages, your share, how fast each side replies, who starts', t.total === 41 && t.sent === 20 && t.recv === 21 && t.share === 49 && t.replyMine === 'within 5 minutes' && t.replyTheirs === 'within 5 minutes' && t.talks === 6 && t.theyStart === 67, J(t));
  check('…what was shared: a photo, a link, a call', t.media === 1 && J(t.kinds) === '{"p":1}' && t.links === 1 && t.calls === 1);
  check('…from the contacts: nickname, work, birthday, starred, photo', pr.contact.card.nickname === 'Annie' && pr.contact.card.organization === 'Lakeside Co' && pr.contact.birthday?.md === '03-02' && pr.contact.birthday.text === '2 March' && pr.contact.starred === true && pr.contact.photo === 'conversations/Ana Lopez/contact/Ana Lopez.jpg', J(pr.contact));
  check('…the years, each way, with what stood out', J(pr.years.map((y) => [y.y, y.sent, y.recv])) === '[["2020",20,19],["2021",0,2]]' && pr.years[0].topics.some((x) => x.w === 'hiking'), J(pr.years));
  check('…when you talk', pr.hours.length === 24 && pr.hours[10] === 37 && pr.week.length === 7 && pr.week.reduce((a, b) => a + b) === 41, J(pr.hours));
  check('…topics, shared or their own', pr.topics.some((x) => x.w === 'hiking' && x.n === 18 && x.shared === true) && pr.topics.some((x) => x.w === 'weekend' && x.n === 9 && x.shared === false) && !pr.topics.some((x) => x.w === 'cleo'), J(pr.topics));
  check('…who they name', J(pr.mentions.out.map((x) => [x.q.id, x.n])) === J([[CLEO, 9]]) && pr.mentions.into.length === 0 && J(GG.profile(graph, CLEO).mentions.into.map((x) => [x.q.id, x.n])) === J([[ANA, 9]]));
  check('…who they are in groups with', J(pr.together.map((x) => [x.q.id, x.n])) === J([[BEN, 1], [CLEO, 1]]), J(pr.together.map((x) => [x.q.id, x.n])));
  check('…relations, resolved to a person or not', J(pr.relations.map((x) => [x.type, x.name, x.q?.id || null])) === J([['sister', 'Cleo Ward', CLEO], ['friend', 'Pat Q', null]]), J(pr.relations.map((x) => [x.type, x.name, x.q?.id])));
  const mo = Object.fromEntries(pr.moments.map((x) => [x.kind, x]));
  check('…moments, each with its day and chat', pr.moments.every((x) => x.row === ROWS[0] || (x.kind === 'birthdays' && !x.d)) && mo.first?.d === '2020-03-01' && mo.first.me === 0 && mo.busiest?.d === '2020-03-02' && mo.busiest.n === 13
    && mo.longest?.d === '2020-03-02' && mo.longest.n === 13 && mo.streak?.n === 3 && mo.streak.from === '2020-03-01' && mo.streak.to === '2020-03-03' && mo.silence?.n === 167 && mo.silence.d === '2021-06-10' && mo.recent?.d === '2021-06-10', J(pr.moments.map(({ row, ...x }) => x)));
  check('…the birthdays you were in touch on', mo.birthdays?.on === 1 && mo.birthdays.of === 2 && mo.birthdays.d === '2020-03-02' && mo.birthdays.row === ROWS[0], J(mo.birthdays));
  check('…events: met up, holidays; no birthday guess when the contacts know it', pr.events.birthday === null && pr.events.met?.n === 1 && pr.events.met.last.d === '2021-06-10' && pr.events.met.last.row === ROWS[0] && J(pr.events.holidays) === '[{"name":"Christmas","years":["2020"]}]' && pr.events.milestones.length === 0 && pr.events.trips.length === 0 && pr.events.photoDays.length === 0, J({ ...pr.events, met: pr.events.met && { n: pr.events.met.n } }));
  check('…emoji each way', J(pr.emoji) === '{"yours":[["🎂",1]],"theirs":[]}', J(pr.emoji));
  check('…their groups, as nodes with their rows', pr.groups.length === 1 && pr.groups[0].node === graph.nodes.get('group:gm-g') && pr.groups[0].row === ROWS[4]);
  const cl = GG.profile(graph, CLEO);
  check('a birthday guessed from a group\'s wishes is an event', cl.events.birthday?.how === 'maybe' && cl.events.birthday.text === '7 July' && J(cl.events.birthday.years) === '["2021"]' && cl.contact.birthday === null && cl.contact.card.labels[0] === 'Pottery' && cl.contact.card.organization === undefined);
  check('a one-way sender\'s profile says so', GG.profile(graph, SHOP).oneWay === true && GG.profile(graph, SHOP).totals.sent === 0 && GG.profile(graph, SHOP).topics.length === 0);

  const tp = GG.profile(graph, 'topic:hiking');
  check('a topic: the word, who, how often, first, last and the day most', tp.type === 'topic' && tp.word === 'hiking' && tp.phrase === false && tp.total === 21 && tp.first === '2020-03-01' && tp.last === '2021-06-11' && J(tp.peak) === '{"d":"2020-03-01","n":6}', J({ ...tp, node: undefined, users: undefined, related: undefined }));
  check('…each user with their dates', J(tp.users.map((u) => [u.node.id, u.n, u.first, u.last, u.peakDay, u.peakN])) === J([[ANA, 18, '2020-03-01', '2020-03-03', '2020-03-01', 6], [BEN, 3, '2021-06-11', '2021-06-11', '2021-06-11', 3]]), J(tp.users.map((u) => [u.node.id, u.n, u.first, u.last, u.peakDay, u.peakN])));
  check('…by year, and the topics the same people share', J(tp.years) === '[{"y":"2020","n":18},{"y":"2021","n":3}]' && tp.related.length === 1 && tp.related[0].node === graph.nodes.get('topic:lake') && tp.related[0].shared === 2, J([tp.years, tp.related.map((r) => [r.node.id, r.shared])]));

  const gp = GG.profile(graph, 'group:gm-g');
  check('a group: row, totals, members as nodes', gp.type === 'group' && gp.row === ROWS[4] && gp.totals.total === 4 && gp.totals.sent === 1 && ids(gp.members) === `${ANA} ${BEN} ${CLEO}` && gp.members[0].id === ANA);
  check('…who talks most, you among them', J(gp.senders.map((s) => [s.name, s.n, s.node?.id])) === J([['Ana Lopez', 2, ANA], ['You', 1, 'you'], ['Ben Carter', 1, BEN]]), J(gp.senders.map((s) => [s.name, s.n, s.node?.id])));
  check('…its years, topics and events', J(gp.years) === '[{"y":"2021","n":4}]' && gp.topics.length === 0 && gp.events.length === 1 && gp.events[0].kind === 'bday' && gp.events[0].for === graph.nodes.get(CLEO));

  const yp = GG.profile(graph, 'year:2021');
  check('a year: totals, months, people and groups of the year', yp.type === 'year' && yp.y === '2021' && yp.total === 12 && yp.media === 1 && J(yp.months) === '[{"m":"2021-06","n":7},{"m":"2021-07","n":4},{"m":"2021-08","n":1}]' && J(yp.people.map((x) => [x.node.id, x.n])) === J([[BEN, 6], [ANA, 2]]) && J(yp.groups.map((x) => [x.node.id, x.n])) === J([['group:gm-g', 4]]), J({ total: yp.total, months: yp.months, people: yp.people.map((x) => [x.node.id, x.n]) }));
  check('…its events and busiest days, each with the chat most talked in', yp.events.map((e) => e.kind).join() === 'meet,bday,bday' && J(yp.busiest.map((b) => [b.d, b.n, b.row.id])) === J([['2021-06-11', 5, 'gm-b'], ['2021-07-03', 3, 'gm-g'], ['2021-06-10', 2, 'gm-a'], ['2021-07-07', 1, 'gm-g'], ['2021-08-12', 1, 'gm-b']]), J(yp.busiest.map((b) => [b.d, b.n, b.row.id])));
  const y20 = GG.profile(graph, 'year:2020');
  check('…what stood out that year, shared ones as nodes', y20.total === 39 && y20.topics.some((x) => x.w === 'hiking' && x.node === graph.nodes.get('topic:hiking')) && y20.topics.some((x) => x.w === 'weekend' && x.node === null), J(y20.topics));

  const lp = GG.profile(graph, 'label:Hiking club');
  check('a label: its people, heaviest first', lp.type === 'label' && lp.name === 'Hiking club' && J(lp.people.map((q) => q.id)) === J([ANA, BEN]));

  const yo = GG.profile(graph, 'you');
  check('you: the archive in numbers', yo.type === 'you' && J(yo.totals) === '{"chats":5,"messages":58,"first":"2019-05-01","last":"2021-08-12","twoWay":3,"oneWay":1,"media":1}', J(yo.totals));
  check('…the years each way, without one-way senders', J(yo.years.map((y) => [y.y, y.sent, y.recv])) === '[["2019",1,3],["2020",20,19],["2021",3,9]]', J(yo.years));
  check('…people, shared topics, groups and your birthday', J(yo.people.map((x) => [x.node.id, x.n])) === J([[ANA, 41], [BEN, 6], [CLEO, 4]]) && J(yo.topics.map((x) => [x.node.id, x.people])) === '[["topic:hiking",2],["topic:lake",2]]' && J(yo.groups.map((x) => [x.node.id, x.n])) === '[["group:gm-g",4]]' && yo.mine === graph.mine);
  check('an unknown id has no profile', GG.profile(graph, 'topic:nothing') === null);
}

// ---------- search ----------
{
  const s = (q, n) => GG.search(graph, q, n).map((x) => x.id);
  check('by name, whatever the case', J(s('ana')) === J([ANA]) && J(s('LOPEZ')) === J([ANA]));
  check('by the digits of a number', J(s('0203')) === J([CLEO]) && J(s('(555) 010-0202')) === J([BEN]));
  check('heaviest first', J(s('hik')) === '["topic:hiking","label:Hiking club"]' && J(s('hik', 1)) === '["topic:hiking"]');
  check('an exact name beats a heavier match', J(s('pottery')) === '["label:Pottery"]' && J(s('ward')) === J([CLEO]) && s('e').length >= 5 && s('e')[0] === ANA);
  check('nothing for nothing', s('zzz').length === 0 && s('').length === 0 && s('12').length === 0);
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
