// The graph model behind the viewer's Graph view: the archive as nodes and
// links, as Obsidian's graph shows the notes (obsidian.js works the same
// things out to write them; this works them out as data), but never all of
// it at once: an ego graph round one focus, a step or two out, laid out the
// same way every time, with the focus's profile beside it. Pure functions
// over the viewer's chat rows and what each chat says (GMLib.analyse, the
// analysis the notes keep): no DOM, no clock, no randomness, and every sort
// has a tie-break on ids, so the same archive always gives the same graph
// and the same picture, and a screenshot can be reproduced for a report.
// The viewer (viewer.js, its graph and profiles sections) draws it.
//
// Ids: 'you'; 'person:<key>' (GMLib.people's key, the person's first chat's
// key); 'topic:<word or phrase>'; 'group:<chat key>'; 'year:<YYYY>';
// 'label:<label>'. A node is { id, type, key, label, w, … }: w is its
// weight (messages for you, a person, a group or a year; uses for a topic;
// people for a label). An edge is { a, b, kind, w, dir? }: chat (you–person),
// talks (person or group–topic, you–topic), named (person→person, directed:
// a names b in your chats with them), member (person–group, you–group),
// together (person–person, in groups together), active (person or
// group–year, you–year), label (person–label, you–label) and relation
// (person–person, from the phone's contacts; `type` says which).
globalThis.GMGraph = globalThis.GMGraph || (() => {
  const L = () => globalThis.GMLib;
  const TYPES = ['you', 'person', 'topic', 'group', 'year', 'label'];
  // How many of each type a ring of an ego graph shows: the heaviest; the rest are counted as hidden.
  const CAPS = { person: 14, topic: 10, group: 6, year: 12, label: 6 };

  // ---------- helpers ----------
  const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  const byWeight = (x, y) => y.w - x.w || cmp(x.id, y.id);
  const bump = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);
  const pct = (x, n) => (n ? Math.round((100 * x) / n) : 0);
  const other = (e, id) => (e.a === id ? e.b : e.a);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // "1990-05-04" or, without the year, "--05-04" (a contact's birthday).
  function birthday(b) {
    const m = String(b || '').match(/^(?:(\d{4})|-)-(\d\d)-(\d\d)/);
    if (!m || +m[2] < 1 || +m[2] > 12) return null;
    return { md: `${m[2]}-${m[3]}`, year: m[1] || null, text: `${+m[3]} ${MONTHS[+m[2] - 1]}${m[1] ? ` ${m[1]}` : ''}` };
  }
  const mdText = (md) => `${+md.slice(3, 5)} ${MONTHS[+md.slice(0, 2) - 1]}`;
  // What someone's chats know from their contact (as the notes read it): the
  // address book's entry first, then the chats' cards (nickname, work,
  // birthday, labels, relations), their photo, and whether they're starred.
  function contactOf(p) {
    const { name: _n, starred: bookStar, ...card } = p.contact || {};
    let photo = null;
    let starred = !!bookStar;
    for (const r of p.chats) {
      const c = (r.contact?.people || []).find((x) => (x.n ?? x.name) !== 'Me');
      if (!c) continue;
      if (c.fav || c.favorite) starred = true;
      if (!photo && c.photo) photo = c.photo;
      for (const [k, v] of Object.entries(c.card || {})) {
        if (Array.isArray(v)) card[k] = [...(card[k] || []), ...v];
        else if (card[k] == null) card[k] = v;
      }
    }
    for (const k of ['numbers', 'emails', 'labels']) if (card[k]) card[k] = [...new Set(card[k])];
    if (card.relations) card.relations = [...new Map(card.relations.map((x) => [`${x.type}|${x.name}`, x])).values()];
    return { card, photo, starred };
  }
  // The chat of a person's with the most messages on a day.
  const busiestOn = (p, cache, d) => p.chats.reduce((best, r) => ((cache.get(r)?.days?.[d] || 0) > (cache.get(best)?.days?.[d] || 0) ? r : best), p.chats[0]);

  // ---------- build ----------
  // The whole graph from the viewer's rows (each with its compact messages),
  // who's who (`P`, GMLib.people), what each chat says (`cache`: row → its
  // analysis; a row without one is analysed here, without folded reactions)
  // and the phone's address book (`book`, contacts.json). Returns
  // { nodes, edges, adj, byType, oneWay, events, byPerson, birthdays, mine, ctx }:
  // nodes a Map by id, adj each node's edges, byType each type's ids
  // (heaviest first), oneWay the ids of senders you've never written to,
  // events as the notes find them ({ d, row, person, kind, me, hint, n? }
  // with `person` a node), byPerson each person's, birthdays each person's
  // (from the contacts, or 'probably'/'maybe' from wishes) and mine yours.
  function build({ rows = [], P = null, cache = new Map(), book = null, saved = null } = {}) {
    const G0 = L();
    P = P || G0.people(rows, saved, book);
    for (const r of rows) if (!cache.has(r)) cache.set(r, G0.analyse((r.messages || []).filter((m) => !m.rxOf), null));
    // People: what their chats say added up.
    const A = new Map(P.list.map((p) => [p, G0.mergeAnalyses(p.chats.map((r) => cache.get(r)).filter(Boolean))]));
    // Who's in each chat: the person of a one-to-one chat, those found in a group.
    const members = new Map();
    for (const p of P.list) {
      for (const r of p.chats) members.set(r, [p]);
      for (const g of P.groupsOf(p)) { if (!members.has(g)) members.set(g, []); members.get(g).push(p); }
    }
    // Who in a chat said something, by the key analyse gives them.
    const memberOf = (who) => {
      const byTel = new Map();
      const byName = new Map();
      for (const p of who) {
        for (const id of p.ids) if (id.startsWith('tel:')) byTel.set(id, p);
        for (const n of new Set([p.name, ...p.names].map(G0.nameKey))) byName.set(n, byName.has(n) && byName.get(n) !== p ? null : p);
      }
      return (k) => (k.startsWith('tel:') ? byTel.get(k) : byName.get(k.slice(5))) || null;
    };
    // Someone you've never written to is one-way: codes, alerts, businesses,
    // spam. They're nodes (shown on request), but stay out of topics,
    // mentions, the years, events and the lists of who matters. Only in apps
    // where you've sent something somewhere: an export that can't tell your
    // messages apart says nothing. A chat whose messages couldn't be loaded
    // (`missingFile`) says nothing either.
    const writes = new Set(rows.filter((r) => cache.get(r)?.sent).map((r) => G0.serviceOf(r)));
    const oneWayP = new Set(P.list.filter((p) => !A.get(p).sent && !p.chats.some((r) => r.missingFile) && p.chats.every((r) => writes.has(G0.serviceOf(r)))));
    const two = { ...P, list: P.list.filter((p) => !oneWayP.has(p)) };
    const inCal = (r) => !oneWayP.has(P.byChat.get(G0.chatKey(r)));
    const groups = rows.filter((r) => G0.isGroupChat(r));

    // Topics: each person's (and each group chat's) words and phrases that
    // stand out; one two or more share is a node that links them. Names are
    // connections, not topics.
    const named = new Set(P.list.flatMap((p) => [p.name, ...p.names]).flatMap((x) => String(x).toLowerCase().match(G0.WORD) || []));
    const docs = [];
    const docOf = new Map();
    for (const p of two.list) { const t = A.get(p); if (Object.keys(t.terms).length) { const d = { kind: 'person', id: p, terms: t.terms }; docs.push(d); docOf.set(p, d); } }
    for (const r of groups) {
      const a = cache.get(r);
      if (a && inCal(r) && a.sent + a.recv >= 20 && Object.keys(a.terms).length) { const d = { kind: 'group', id: r, terms: a.terms }; docs.push(d); docOf.set(r, d); }
    }
    const T = G0.standout(docs, named);
    const topicPeople = new Map([...T.nodes].map(([w, list]) => [w, new Set(list.map((x) => x.d))]));
    const yearly = new Map();
    for (const d of docs) {
      const yt = d.kind === 'person' ? Object.entries(A.get(d.id).yterms).map(([y, m]) => [y, Object.entries(m)]) : Object.entries(cache.get(d.id).yterms);
      for (const [y, ws] of yt) { if (!yearly.has(y)) yearly.set(y, new Map()); for (const [w, n] of ws) bump(yearly.get(y), w, n); }
    }
    const yearTopics = G0.byYear(yearly, named, 8, 4);
    // Who's named in whose chats.
    const M = G0.mentionsOf(two, cache);
    // From the phone's contacts: labels, and relations by name (among the
    // people, or through the address book: a contact whose numbers are a
    // person's).
    const K = new Map(P.list.map((p) => [p, contactOf(p)]));
    const byLabel = new Map();
    for (const p of P.list) for (const l of K.get(p).card.labels || []) { if (!byLabel.has(l)) byLabel.set(l, []); byLabel.get(l).push(p); }
    const R = new Map();
    for (const p of P.list) for (const x of new Set([p.name, ...p.names].map(G0.nameKey))) R.set(x, R.has(x) && R.get(x) !== p ? null : p);
    const byContact = new Map(P.list.flatMap((p) => p.ids.filter((i) => i.startsWith('contact:')).map((i) => [i.slice(8), p])));
    const bookName = new Map();
    for (const c of book?.contacts || []) { const k = G0.nameKey(c.name); if (k.length > 1 && c.key) bookName.set(k, bookName.has(k) && bookName.get(k) !== c ? null : c); }
    const relationOf = (name) => { const k = G0.nameKey(name); const p = R.get(k); if (p) return p; const c = bookName.get(k); return (c && byContact.get(c.key)) || null; };
    // Groups in common: who someone is in groups with, and in how many.
    const C = new Map();
    for (const p of P.list) {
      const c = new Map();
      for (const g of P.groupsOf(p)) for (const q of members.get(g) || []) if (q !== p) bump(c, q);
      C.set(p, [...c].map(([q, k]) => ({ q, n: k })).sort((x, y) => y.n - x.n || cmp(x.q.key, y.q.key)));
    }
    // The calendar's days, from every chat but one-way senders'.
    const D = new Map();
    for (const r of rows) {
      const a = cache.get(r);
      if (!a || !inCal(r)) continue;
      for (const [d, c] of Object.entries(a.days)) { let x = D.get(d); if (!x) D.set(d, (x = { chats: [], total: 0, media: 0 })); x.chats.push([r, c]); x.total += c; }
      for (const [d, c] of Object.entries(a.mdays)) { const x = D.get(d); if (x) x.media += c; }
    }
    const yearTotal = new Map();
    for (const [d, x] of D) bump(yearTotal, d.slice(0, 4), x.total);

    // The nodes.
    const nodes = new Map();
    const add = (n) => { nodes.set(n.id, n); return n; };
    // How a person shows under their name: their number, email or handle.
    const subOf = (p) => {
      const tel = p.ids.find((i) => i.startsWith('tel:'));
      if (tel) return G0.formatNumber(tel.slice(4));
      const em = p.ids.find((i) => i.startsWith('email:'));
      if (em) return em.slice(6);
      const h = p.ids.find((i) => !i.startsWith('contact:'));
      return h ? `${G0.serviceLabel(h.slice(0, h.indexOf(':')))} ${h.slice(h.indexOf(':') + 1)}` : p.services.map((s) => G0.serviceLabel(s)).join(', ');
    };
    const personNode = new Map();
    for (const p of P.list) {
      const t = A.get(p);
      personNode.set(p, add({ id: `person:${p.key}`, type: 'person', key: p.key, label: p.name, sub: subOf(p), w: t.sent + t.recv, oneWay: oneWayP.has(p), services: p.services, ref: p }));
    }
    const you = add({ id: 'you', type: 'you', key: '', label: 'You', w: two.list.reduce((n, p) => n + A.get(p).sent + A.get(p).recv, 0) });
    const groupNode = new Map();
    for (const r of groups) {
      const a = cache.get(r);
      groupNode.set(r, add({ id: `group:${G0.chatKey(r)}`, type: 'group', key: G0.chatKey(r), label: G0.formatNumber(r.title || ''), w: a ? a.sent + a.recv : 0, service: G0.serviceOf(r), ref: r }));
    }
    const nodeOfDoc = (d) => (d.kind === 'person' ? personNode.get(d.id) : groupNode.get(d.id));
    for (const [w, list] of [...T.nodes].sort(([x], [y]) => cmp(x, y))) add({ id: `topic:${w}`, type: 'topic', key: w, label: w, w: list.reduce((n, x) => n + x.n, 0), people: list.length, phrase: w.includes(' ') });
    for (const [y, n] of [...yearTotal].sort(([x], [z]) => cmp(x, z))) add({ id: `year:${y}`, type: 'year', key: y, label: y, w: n });
    for (const [l, list] of [...byLabel].sort(([x], [y]) => cmp(x, y))) add({ id: `label:${l}`, type: 'label', key: l, label: l, w: list.length });

    // The edges, each pair once per kind (a directed one once per direction).
    const edges = [];
    const seen = new Set();
    const link = (kind, a, b, w, more = null) => {
      if (!a || !b || a === b || !nodes.has(a) || !nodes.has(b)) return;
      const key = more?.dir ? `${kind}|${a}|${b}` : `${kind}|${[a, b].sort(cmp).join('|')}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ a, b, kind, w, ...(more || {}) });
    };
    for (const p of P.list) {
      const t = A.get(p);
      const n = personNode.get(p);
      link('chat', you.id, n.id, t.sent + t.recv);
      for (const [y, [s, r]] of Object.entries(t.years)) link('active', n.id, `year:${y}`, s + r);
      for (const l of K.get(p).card.labels || []) link('label', n.id, `label:${l}`, 1);
    }
    for (const [w, list] of T.nodes) {
      let total = 0;
      for (const x of list) { link('talks', nodeOfDoc(x.d).id, `topic:${w}`, x.n); total += x.n; }
      link('talks', you.id, `topic:${w}`, total);
    }
    for (const [p, list] of M.out) for (const x of list) link('named', personNode.get(p).id, personNode.get(x.q).id, x.n, { dir: true });
    for (const r of groups) {
      const g = groupNode.get(r);
      const a = cache.get(r);
      const who = members.get(r) || [];
      // A member's weight in a group: what they said in it, by number or name; one for a member who never spoke.
      const spoke = new Map();
      if (a) { const find = memberOf(who); for (const [k, , n] of a.senders) { if (k === 'me') continue; const q = find(k); if (q) bump(spoke, q, n); } }
      for (const q of who) link('member', personNode.get(q).id, g.id, spoke.get(q) || 1);
      link('member', you.id, g.id, g.w);
      if (a) for (const [y, [s, rc]] of Object.entries(a.years)) link('active', g.id, `year:${y}`, s + rc);
    }
    for (const [p, list] of C) for (const x of list) link('together', personNode.get(p).id, personNode.get(x.q).id, x.n);
    for (const p of P.list) {
      for (const x of K.get(p).card.relations || []) {
        const q = relationOf(x.name);
        if (q && q !== p) link('relation', personNode.get(p).id, personNode.get(q).id, 1, { type: x.type });
      }
    }
    for (const n of nodes.values()) {
      if (n.type === 'year') link('active', you.id, n.id, n.w);
      if (n.type === 'label') link('label', you.id, n.id, n.w);
    }
    const adj = new Map([...nodes.keys()].map((id) => [id, []]));
    for (const e of edges) { adj.get(e.a).push(e); adj.get(e.b).push(e); }
    const byType = Object.fromEntries(TYPES.map((t) => [t, []]));
    for (const n of [...nodes.values()].sort(byWeight)) byType[n.type].push(n.id);

    // Events, from every chat but one-way senders', in order. A group's
    // birthday wishes for someone by first name ("Happy birthday Cleo!") are
    // theirs too, when only one person has that first name.
    const firstNames = new Map();
    for (const p of two.list) { const f = /\p{L}/u.test(p.name) ? G0.nameKey(p.name.split(/\s+/)[0]) : ''; if (f.length >= 3) firstNames.set(f, firstNames.has(f) ? null : p); }
    const E = [];
    const byPerson = new Map();
    const toPerson = (n, e) => { if (!byPerson.has(n.id)) byPerson.set(n.id, []); byPerson.get(n.id).push(e); };
    for (const r of rows) {
      const a = cache.get(r);
      if (!a || !inCal(r)) continue;
      const p = P.byChat.get(G0.chatKey(r)) || null;
      const person = p ? personNode.get(p) : null;
      const push = (e) => { E.push(e); if (person) toPerson(person, e); if (e.for) toPerson(e.for, e); };
      for (const [dn, kind, me, hint] of a.events) {
        const e = { d: G0.numDay(dn), row: r, person, kind, me, hint };
        if (!person && kind === 'bday' && hint && hint !== 'belated') { const q = firstNames.get(G0.nameKey(hint)); e.for = q ? personNode.get(q) : null; }
        push(e);
      }
      for (const [d, c] of Object.entries(a.mdays)) if (c >= G0.PHOTO_DAY) push({ d, row: r, person, kind: 'photos', me: 0, hint: '', n: c });
    }
    const byDate = (x, y) => cmp(x.d, y.d);
    E.sort(byDate);
    for (const l of byPerson.values()) l.sort(byDate);
    // Birthdays: from the contacts, or the days you wished them happy
    // birthday (probably when the same day in two years or more, maybe when
    // once); and yours, the day most people wished you happy birthday.
    const B = new Map();
    const wished = new Map();
    const yours = new Map(); // month-day -> Map(year -> Set(person id))
    const add2 = (map, k1, k2, v) => { if (!map.has(k1)) map.set(k1, new Map()); const m = map.get(k1); if (!m.has(k2)) m.set(k2, new Set()); m.get(k2).add(v); };
    for (const e of E) {
      if (e.kind !== 'bday' || e.hint === 'belated') continue;
      const md = e.d.slice(5);
      const y = e.d.slice(0, 4);
      const them = e.for || (e.person && e.me ? e.person : null);
      if (them) add2(wished, them.id, md, y);
      else if (e.person) add2(yours, md, y, e.person.id);
    }
    for (const p of two.list) {
      const id = personNode.get(p).id;
      const b = birthday(K.get(p).card.birthday);
      if (b) { B.set(id, { ...b, how: 'contacts', years: [] }); continue; }
      const m = wished.get(id);
      if (!m) continue;
      const [md, ys] = [...m].sort((x, y) => y[1].size - x[1].size || cmp(x[0], y[0]))[0];
      B.set(id, { md, year: null, text: mdText(md), how: ys.size >= 2 ? 'probably' : 'maybe', years: [...ys].sort() });
    }
    let mine = null;
    for (const [md, ys] of [...yours].sort(([x], [y]) => cmp(x, y))) {
      const total = [...ys.values()].reduce((t, s) => t + s.size, 0);
      if (total >= 3 && (!mine || total > mine.total)) mine = { md, text: mdText(md), total, years: [...ys].sort((a, b) => cmp(b[0], a[0])).map(([y, s]) => [y, s.size]) };
    }

    return {
      nodes, edges, adj, byType, oneWay: new Set([...oneWayP].map((p) => personNode.get(p).id)), events: E, byPerson, birthdays: B, mine,
      ctx: { rows, P, cache, book, A, T, M, C, K, R, D, members, memberOf, docOf, yearTopics, two, oneWayP, named, topicPeople, byLabel, relationOf, personNode, groupNode, inCal, groups },
    };
  }

  // ---------- ego ----------
  // The graph round one node: ring 1 is what links to it, ring 2 (depth 2)
  // what links to those, each ring the heaviest of each type up to CAPS,
  // the rest counted in `hidden`. Options: depth (1 or 2), types (a Set of
  // node types to show; the focus always shows), oneWay (show senders
  // you've never written to), services (a Set of apps: only people and
  // groups in them). You are the hub of everything, so you are the centre
  // of your own graph and never a neighbour in anyone else's. Returns
  // { focus, depth, nodes, edges, hidden }: nodes copies of the graph's with
  // ring (0, 1, 2), link (the weight of the link that brought them in) and,
  // on ring 2, via (the ring-1 node's id); edges every edge between them.
  function ego(G, id, opts = {}) {
    const focus = G.nodes.get(id);
    if (!focus) throw new Error(`No such node in the graph: ${id}`);
    const depth = opts.depth === 2 ? 2 : 1;
    const asSet = (v) => (v == null ? null : v instanceof Set ? v : new Set(v));
    const types = asSet(opts.types);
    const services = asSet(opts.services);
    const inApps = (n) => (n.type === 'person' ? (n.services || []).some((s) => services.has(s)) : n.type === 'group' ? services.has(n.service) : true);
    const ok = (n) => n.type !== 'you' && (!types || types.has(n.type)) && (opts.oneWay || !n.oneWay) && (!services || inApps(n));
    const hidden = Object.fromEntries(Object.keys(CAPS).map((t) => [t, 0]));
    const order = (x, y) => TYPES.indexOf(x.type) - TYPES.indexOf(y.type) || y.link - x.link || cmp(x.id, y.id);
    const cap = (cands) => {
      const byT = new Map();
      for (const c of cands.values()) { if (!byT.has(c.type)) byT.set(c.type, []); byT.get(c.type).push(c); }
      const kept = [];
      for (const [t, list] of byT) {
        list.sort((x, y) => y.link - x.link || cmp(x.id, y.id));
        const max = CAPS[t] ?? list.length;
        kept.push(...list.slice(0, max));
        hidden[t] = (hidden[t] || 0) + Math.max(0, list.length - max);
      }
      return kept.sort(order);
    };
    const ring1 = new Map();
    for (const e of G.adj.get(id) || []) {
      const n = G.nodes.get(other(e, id));
      if (!ok(n)) continue;
      const c = ring1.get(n.id);
      if (!c || e.w > c.link) ring1.set(n.id, { ...n, ring: 1, link: e.w });
    }
    const kept1 = cap(ring1);
    const inside = new Set([id, ...kept1.map((n) => n.id)]);
    let kept2 = [];
    if (depth === 2) {
      const ring2 = new Map();
      for (const v of kept1) {
        for (const e of G.adj.get(v.id) || []) {
          const o = other(e, v.id);
          if (inside.has(o)) continue;
          const n = G.nodes.get(o);
          if (!ok(n)) continue;
          const c = ring2.get(o);
          if (!c || e.w > c.link) ring2.set(o, { ...n, ring: 2, link: e.w, via: v.id });
        }
      }
      kept2 = cap(ring2);
      for (const n of kept2) inside.add(n.id);
    }
    const nodes = [{ ...focus, ring: 0 }, ...kept1, ...kept2];
    const edges = G.edges.filter((e) => inside.has(e.a) && inside.has(e.b));
    return { focus, depth, nodes, edges, hidden };
  }

  // ---------- layout ----------
  // Where everything goes in a box of width × height: the focus at the
  // centre, ring 1 on a circle round it and ring 2 on a circle round that,
  // no physics. On a ring the nodes go in sector order (TYPES: people, then
  // topics, groups, years, labels), the heaviest first in each, from the top
  // clockwise, each taking the arc it needs (a topic is a pill as wide as
  // its word), with a gap between sectors and the slack shared out; ring 2's
  // nodes sit beside the ring-1 node they came through. A ring that can't
  // hold its nodes shrinks them, and a few passes nudge neighbours that
  // still touch apart (a chord is shorter than its arc). Node size follows
  // the weight of its link to the focus. Returns { width, height, cx, cy,
  // nodes: [{ id, x, y, r, ring }], edges: [{ a, b, kind, w, dir, sw, x1, y1, x2, y2 }] },
  // coordinates to a tenth.
  function layout(ego, { width = 900, height = 600 } = {}) {
    const r1 = (v) => Math.round(v * 10) / 10;
    const W = Math.max(80, Math.round(width));
    const H = Math.max(80, Math.round(height));
    const cx = W / 2;
    const cy = H / 2;
    const A = Math.min(W, H) / 2 - 18; // how far from the centre a node may reach, with room for its label
    const k = Math.min(1, A / 140); // everything shrinks together in a small box
    const GAP = 6 * k;
    const SGAP = 14 * k;
    const R0 = 26 * k;
    const SIZE1 = [10 * k, 22 * k];
    const SIZE2 = [7 * k, 13 * k];
    const ring1 = ego.nodes.filter((n) => n.ring === 1);
    const ring2 = ego.nodes.filter((n) => n.ring === 2);
    const order = (x, y) => TYPES.indexOf(x.type) - TYPES.indexOf(y.type) || y.link - x.link || cmp(x.id, y.id);
    ring1.sort(order);
    const size = (list, [lo, hi]) => { const max = Math.max(1, ...list.map((n) => n.link || 0)); return list.map((n) => [n.id, lo + (hi - lo) * Math.sqrt((n.link || 0) / max)]); };
    const rad = new Map([...size(ring1, SIZE1), ...size(ring2, SIZE2)]);
    // The arc a node takes: its radius (already shrunk when its ring is squeezed), or
    // for a topic half the pill the viewer draws, which doesn't shrink with it.
    // On ring 2 a node's label below it needs room too, or neighbours' labels run together.
    // A year or group is drawn as a square, whose corners reach further than a circle's edge.
    const SQUARE = 1.25;
    const typeOf = new Map(ego.nodes.map((n) => [n.id, n.type]));
    const reach = (id) => rad.get(id) * (typeOf.get(id) === 'year' || typeOf.get(id) === 'group' ? SQUARE : 1);
    const pillHalf = (n) => (Math.min(24, String(n.label).length) * 6.6 + 18) / 2;
    const span = (n) => (n.type === 'topic' ? Math.max(rad.get(n.id), pillHalf(n)) : n.ring === 2 ? Math.max(reach(n.id), 26 * k) : reach(n.id));
    const sectors = (list) => new Set(list.map((n) => n.type)).size;
    // A topic's pill is wider than tall: on a ring's left or right it reaches further
    // out sideways than a circle would, so a ring with topics stays that much further in.
    const widest = (list) => Math.max(0, ...list.filter((n) => n.type === 'topic').map(pillHalf));
    const far2 = ring2.length ? Math.min(A - SIZE2[1], W / 2 - 8 - widest(ring2)) : 0; // as far out as ring 2 may go
    const min1 = R0 + SIZE1[1] + 14 * k;
    const max1 = Math.max(min1, Math.min(ring2.length ? far2 - SIZE2[1] - SIZE1[1] - 10 * k : A - SIZE1[1], W / 2 - 8 - widest(ring1)));
    const need = (list) => list.reduce((t, n) => t + 2 * span(n) + GAP, 0) + (sectors(list) > 1 ? sectors(list) * SGAP : 0);
    // Ring 1 a comfortable way out when there's room (a third of the box, so a
    // few nodes aren't huddled round the focus), further when they need it, never past the box.
    const radius1 = ring1.length ? Math.min(max1, Math.max(min1, Math.min(W, H) * 0.3, (need(ring1) * 1.08) / (2 * Math.PI))) : min1;
    // Ring 2 a step outside ring 1 (so a node sits near its way in), further when its nodes need the room.
    const outer2 = ring2.length ? Math.min(far2, Math.max(radius1 + SIZE1[1] + SIZE2[1] + 24 * k, radius1 + 100 * k, (need(ring2) * 1.08) / (2 * Math.PI))) : 0;
    // A ring too small for its nodes: squeeze their arcs (and shrink the circles) to fit.
    const fit = (list, ring, R) => {
      if (!list.length) return;
      const room = 2 * Math.PI * R - list.length * GAP - (sectors(list) > 1 ? sectors(list) * SGAP : 0);
      const want = list.reduce((t, n) => t + 2 * span(n), 0);
      if (want > room) {
        const f = Math.max(0.35, room / want);
        for (const n of list) rad.set(n.id, rad.get(n.id) * f);
      }
    };
    // Whatever still doesn't fit (pills don't shrink, and circles only so far) is
    // spaced closer rather than carried past a full turn onto the first nodes.
    const close = (total, R) => Math.min(1, (2 * Math.PI * R) / Math.max(total, 1e-9));
    const at = new Map(); // id -> angle (radians; 0 is right, clockwise on screen)
    let q1 = 1; // how much ring 1's arcs had to close up to fit (1: they had room)
    let q2 = 1;
    fit(ring1, 1, radius1);
    {
      const n = ring1.length;
      const ns = sectors(ring1) > 1 ? sectors(ring1) : 0;
      const total = ring1.reduce((t, x) => t + 2 * span(x) + GAP, 0) + ns * SGAP;
      const extra = n ? Math.max(0, 2 * Math.PI * radius1 - total) / n : 0;
      const q = (q1 = close(total, radius1));
      let cur = -Math.PI / 2;
      ring1.forEach((x, i) => {
        const arc = (2 * span(x) + GAP) * q + extra;
        at.set(x.id, cur + arc / 2 / radius1);
        cur += arc / radius1;
        if (ns && (i === n - 1 || ring1[i + 1].type !== x.type)) cur += (SGAP * q) / radius1;
      });
    }
    // Ring 2: beside the way in, those with the same way in side by side.
    if (ring2.length) {
      fit(ring2, 2, outer2);
      q2 = close(ring2.reduce((t, x) => t + 2 * span(x) + GAP, 0), outer2);
      const kids = new Map();
      for (const x of ring2) { if (!kids.has(x.via)) kids.set(x.via, []); kids.get(x.via).push(x); }
      for (const v of ring1) {
        const list = kids.get(v.id);
        if (!list) continue;
        list.sort(order);
        const total = list.reduce((t, x) => t + (2 * span(x) + GAP) * q2, 0);
        let cur = at.get(v.id) - total / 2 / outer2;
        for (const x of list) { const arc = (2 * span(x) + GAP) * q2; at.set(x.id, cur + arc / 2 / outer2); cur += arc / outer2; }
      }
    }
    // Neighbours on a ring that still touch are nudged apart, a few passes.
    const spread = (list, R) => {
      if (list.length < 2) return;
      const norm = (th) => (((th + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const ids = list.map((x) => x.id);
      for (let pass = 0; pass < 12; pass++) {
        ids.sort((x, y) => norm(at.get(x)) - norm(at.get(y)) || cmp(x, y));
        let moved = false;
        for (let i = 0; i < ids.length; i++) {
          const a = ids[i];
          const b = ids[(i + 1) % ids.length];
          const min = reach(a) + reach(b) + 2;
          if (min >= 2 * R) continue; // can't be helped on a ring this small
          let gap = at.get(b) - at.get(a);
          if (ids.length > 1 && i === ids.length - 1) gap += 2 * Math.PI;
          gap = ((gap % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const want = 2 * Math.asin(min / (2 * R));
          if (gap < want) { const d = (want - gap) / 2 + 1e-9; at.set(a, at.get(a) - d); at.set(b, at.get(b) + d); moved = true; }
        }
        if (!moved) break;
      }
    };
    // Only a ring that had room: on a full one the nudges can't succeed and would scramble its order.
    if (q1 >= 1) spread(ring1, radius1);
    if (q2 >= 1) spread(ring2, outer2);
    const out = [{ id: ego.focus.id, x: r1(cx), y: r1(cy), r: r1(R0), ring: 0 }];
    for (const [list, R] of [[ring1, radius1], [ring2, outer2]]) {
      for (const x of list) { const th = at.get(x.id); out.push({ id: x.id, x: r1(cx + R * Math.cos(th)), y: r1(cy + R * Math.sin(th)), r: r1(rad.get(x.id)), ring: x.ring }); }
    }
    const pos = new Map(out.map((n) => [n.id, n]));
    const maxW = Math.max(1, ...ego.edges.map((e) => e.w || 0));
    const edges = ego.edges.map((e) => {
      const a = pos.get(e.a);
      const b = pos.get(e.b);
      return { a: e.a, b: e.b, kind: e.kind, w: e.w, dir: !!e.dir, sw: r1(1 + 2.5 * ((e.w || 0) / maxW)), x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });
    return { width: W, height: H, cx, cy, nodes: out, edges };
  }

  // ---------- profile ----------
  // Everything the archive knows about a node, added up across its chats,
  // as the Obsidian notes say it (obsidian.js's person, topic, year and
  // group notes), but as data for the viewer to draw. Null for an unknown id.
  function profile(G, id) {
    const n = G.nodes.get(id);
    if (!n) return null;
    if (n.type === 'person') return personProfile(G, n);
    if (n.type === 'topic') return topicProfile(G, n);
    if (n.type === 'group') return groupProfile(G, n);
    if (n.type === 'year') return yearProfile(G, n);
    if (n.type === 'label') return labelProfile(G, n);
    return youProfile(G, n);
  }
  // The moments of all of someone's chats, each with the day and the chat
  // it was in: the first message, the busiest day, the longest conversation,
  // the longest streak and silence, the most recent, and the birthdays you
  // were in touch on (`bday`: theirs, from the contacts or from wishes).
  function momentsOf(G, p, t, bday) {
    const G0 = L();
    const cache = G.ctx.cache;
    const out = [];
    const chats = p.chats.map((r) => [r, cache.get(r)]).filter(([, a]) => a);
    const firsts = chats.filter(([, a]) => a.first).sort(([, x], [, y]) => cmp(x.first.d, y.first.d));
    if (firsts.length) { const [r, a] = firsts[0]; out.push({ kind: 'first', d: a.first.d, row: r, me: a.first.me }); }
    const ds = Object.keys(t.days).sort();
    const at = (d) => busiestOn(p, cache, d);
    if (ds.length > 1) { const busiest = ds.reduce((x, y) => (t.days[y] > t.days[x] ? y : x)); out.push({ kind: 'busiest', d: busiest, row: at(busiest), n: t.days[busiest] }); }
    const longest = chats.filter(([, a]) => a.longest).sort(([, x], [, y]) => y.longest.n - x.longest.n)[0];
    if (longest && longest[1].longest.n >= 10) out.push({ kind: 'longest', d: longest[1].longest.d, row: longest[0], n: longest[1].longest.n });
    if (ds.length) {
      let run = [ds[0], ds[0]];
      let best = run;
      let gap = null;
      for (let i = 1; i < ds.length; i++) {
        const g = G0.dayNum(ds[i]) - G0.dayNum(ds[i - 1]);
        run = g === 1 ? [run[0], ds[i]] : [ds[i], ds[i]];
        if (G0.dayNum(run[1]) - G0.dayNum(run[0]) > G0.dayNum(best[1]) - G0.dayNum(best[0])) best = run;
        if (!gap || g > gap.g) gap = { g, d: ds[i] };
      }
      const streak = G0.dayNum(best[1]) - G0.dayNum(best[0]) + 1;
      if (streak >= 3) out.push({ kind: 'streak', d: best[0], from: best[0], to: best[1], row: at(best[0]), n: streak });
      if (gap && gap.g >= 30) out.push({ kind: 'silence', d: gap.d, row: at(gap.d), n: gap.g });
      if (ds.length > 1) out.push({ kind: 'recent', d: ds[ds.length - 1], row: at(ds[ds.length - 1]) });
      if (bday) {
        const years = [];
        for (let y = +ds[0].slice(0, 4); y <= +ds[ds.length - 1].slice(0, 4); y++) if (`${y}-${bday.md}` >= ds[0] && `${y}-${bday.md}` <= ds[ds.length - 1]) years.push(y);
        const on = years.map((y) => `${y}-${bday.md}`).filter((d) => t.days[d]);
        if (years.length) { const d = on[on.length - 1] || null; out.push({ kind: 'birthdays', d, row: d ? at(d) : null, on: on.length, of: years.length }); }
      }
    }
    return out;
  }
  // A person: the gist (totals, share, how fast each side replies, who
  // starts), what the contacts know, the years (each with what stood out),
  // when you talk, their topics (shared or their own), connections
  // (relations, groups in common, who they name and who names them),
  // moments, events, emoji, chats and groups.
  function personProfile(G, n) {
    const G0 = L();
    const X = G.ctx;
    const p = n.ref;
    const t = X.A.get(p);
    const { card, photo, starred } = X.K.get(p);
    const total = t.sent + t.recv;
    const totals = {
      total, sent: t.sent, recv: t.recv, share: pct(t.sent, total), replyMine: G0.usually(t.reply[1]), replyTheirs: G0.usually(t.reply[0]), talks: t.talks, theyStart: pct(t.starts[0], t.talks),
      kinds: t.kinds, media: t.media, calls: t.calls, links: p.chats.reduce((s, r) => s + (X.cache.get(r)?.links.length || 0), 0),
    };
    const about = G0.byYear(new Map(Object.entries(t.yterms).map(([y, m]) => [y, new Map(Object.entries(m))])), X.named, 3, 2);
    // A year's pair is [received, sent]: analyse counts your messages at index 1.
    const years = Object.keys(t.years).sort().map((y) => ({ y, sent: t.years[y][1], recv: t.years[y][0], topics: about.get(y) || [] }));
    const doc = X.docOf.get(p);
    const topics = ((doc && X.T.of.get(doc)) || []).map((x) => ({ w: x.w, n: x.n, shared: X.T.nodes.has(x.w) }));
    const q = (person) => X.personNode.get(person) || null;
    const relations = (card.relations || []).map((x) => { const who = X.relationOf(x.name); return { type: x.type, name: x.name, q: who && who !== p ? q(who) : null }; });
    const together = (X.C.get(p) || []).map((x) => ({ q: q(x.q), n: x.n }));
    const mentions = { out: (X.M.out.get(p) || []).map((x) => ({ q: q(x.q), n: x.n })), into: (X.M.into.get(p) || []).map((x) => ({ q: q(x.q), n: x.n })) };
    const bday = G.birthdays.get(n.id) || null;
    const evs = G.byPerson.get(n.id) || [];
    const kind = (k) => evs.filter((e) => e.kind === k);
    const met = kind('meet');
    const hol = new Map();
    for (const e of kind('holiday')) { if (!hol.has(e.hint)) hol.set(e.hint, new Set()); hol.get(e.hint).add(e.d.slice(0, 4)); }
    const events = {
      birthday: bday && bday.how !== 'contacts' ? bday : null,
      met: met.length ? { n: met.length, last: { d: met[met.length - 1].d, row: met[met.length - 1].row } } : null,
      milestones: [...kind('congrats'), ...kind('anniv')].sort((x, y) => cmp(y.d, x.d)),
      trips: kind('trip'),
      photoDays: kind('photos').sort((x, y) => y.n - x.n || cmp(x.d, y.d)),
      holidays: [...hol].map(([name, ys]) => ({ name, years: [...ys].sort() })),
    };
    const emo = (e) => Object.entries(e || {}).sort((x, y) => y[1] - x[1] || cmp(x[0], y[0]));
    const groups = X.P.groupsOf(p).map((r) => ({ node: X.groupNode.get(r), row: r })).filter((g) => g.node);
    return {
      type: 'person', node: n, p, totals, contact: { card, photo, starred, birthday: birthday(card.birthday) }, labels: card.labels || [], oneWay: n.oneWay, ids: p.ids,
      years, hours: t.hours, week: t.week, topics, relations, together, mentions, moments: momentsOf(G, p, t, bday), events, emoji: { yours: emo(t.emoji[1]), theirs: emo(t.emoji[0]) }, groups,
    };
  }
  // A topic: who talks about it (people and groups, each with how often,
  // first, last and the day most), how often in all, by year, and the
  // topics the same people share (related).
  function topicProfile(G, n) {
    const G0 = L();
    const X = G.ctx;
    const w = n.key;
    const list = X.T.nodes.get(w) || [];
    const nodeOf = (d) => (d.kind === 'person' ? X.personNode.get(d.id) : X.groupNode.get(d.id));
    const users = list.map((x) => ({ node: nodeOf(x.d), n: x.n, first: G0.numDay(x.t[1]), last: G0.numDay(x.t[2]), peakDay: G0.numDay(x.t[3]), peakN: x.t[4] })).filter((u) => u.node).sort((x, y) => y.n - x.n || cmp(x.node.id, y.node.id));
    const firsts = list.map((x) => x.t[1]).filter(Boolean);
    const peak = list.reduce((b, x) => (!b || x.t[4] > b.t[4] || (x.t[4] === b.t[4] && x.t[3] < b.t[3]) ? x : b), null);
    const years = new Map();
    for (const x of list) {
      const yt = x.d.kind === 'person' ? Object.entries(X.A.get(x.d.id).yterms).map(([y, m]) => [y, m[w] || 0]) : Object.entries(X.cache.get(x.d.id).yterms).map(([y, ws]) => [y, ws.find(([v]) => v === w)?.[1] || 0]);
      for (const [y, c] of yt) if (c) bump(years, y, c);
    }
    const mine = X.topicPeople.get(w) || new Set();
    const related = [...X.topicPeople].filter(([v]) => v !== w).map(([v, s]) => [v, [...s].filter((x) => mine.has(x)).length, s.size]).filter(([, both]) => both >= 2)
      .sort((a, b) => b[1] / (mine.size + b[2] - b[1]) - a[1] / (mine.size + a[2] - a[1]) || cmp(a[0], b[0])).slice(0, 8)
      .map(([v, both]) => ({ node: G.nodes.get(`topic:${v}`), shared: both }));
    return {
      type: 'topic', node: n, word: w, phrase: w.includes(' '), total: list.reduce((s, x) => s + x.n, 0),
      first: firsts.length ? G0.numDay(Math.min(...firsts)) : '', last: list.length ? G0.numDay(Math.max(...list.map((x) => x.t[2]))) : '',
      peak: peak && peak.t[4] ? { d: G0.numDay(peak.t[3]), n: peak.t[4] } : null, users, years: [...years].sort(([x], [y]) => cmp(x, y)).map(([y, c]) => ({ y, n: c })), related,
    };
  }
  // A group chat: who's in it (those People knows), who talks most, what it
  // talked about, by year, and its events.
  function groupProfile(G, n) {
    const X = G.ctx;
    const r = n.ref;
    const a = X.cache.get(r) || null;
    const who = X.members.get(r) || [];
    const find = X.memberOf(who);
    const members = who.map((p) => X.personNode.get(p)).sort(byWeight);
    const senders = (a?.senders || []).map(([k, name, c]) => { const q = k === 'me' ? null : find(k); return { name: k === 'me' ? 'You' : name, n: c, node: k === 'me' ? G.nodes.get('you') : q ? X.personNode.get(q) : null }; });
    const doc = X.docOf.get(r);
    const topics = ((doc && X.T.of.get(doc)) || []).map((x) => ({ w: x.w, n: x.n, node: G.nodes.get(`topic:${x.w}`) || null }));
    const years = Object.keys(a?.years || {}).sort().map((y) => ({ y, n: a.years[y][0] + a.years[y][1] }));
    return { type: 'group', node: n, row: r, totals: { total: a ? a.sent + a.recv : 0, sent: a?.sent || 0, media: a?.media || 0, kinds: a?.kinds || {} }, members, senders, topics, years, events: G.events.filter((e) => e.row === r) };
  }
  // A year: month by month, the people and groups of the year, what stood
  // out, its events and its busiest days (each with the chat most talked in).
  function yearProfile(G, n) {
    const G0 = L();
    const X = G.ctx;
    const y = n.key;
    const days = [...X.D].filter(([d]) => d.startsWith(`${y}-`)).sort(([a], [b]) => cmp(a, b));
    let total = 0;
    let media = 0;
    const months = new Map();
    const byRow = new Map();
    for (const [d, x] of days) { total += x.total; media += x.media; bump(months, d.slice(0, 7), x.total); for (const [r, c] of x.chats) bump(byRow, r, c); }
    const people = new Map();
    const groups = [];
    for (const [r, c] of byRow) { const p = X.P.byChat.get(G0.chatKey(r)); if (p) bump(people, p, c); else if (X.groupNode.has(r)) groups.push({ node: X.groupNode.get(r), n: c }); }
    const busiest = days.map(([d, x]) => ({ d, n: x.total, row: x.chats.slice().sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.n - a.n || cmp(a.d, b.d)).slice(0, 5);
    return {
      type: 'year', node: n, y, total, media, months: [...months].map(([m, c]) => ({ m, n: c })),
      people: [...people].map(([p, c]) => ({ node: X.personNode.get(p), n: c })).sort((a, b) => b.n - a.n || cmp(a.node.id, b.node.id)),
      groups: groups.sort((a, b) => b.n - a.n || cmp(a.node.id, b.node.id)),
      topics: (X.yearTopics.get(y) || []).map((x) => ({ w: x.w, n: x.n, node: G.nodes.get(`topic:${x.w}`) || null })),
      events: G.events.filter((e) => e.d.startsWith(`${y}-`)), busiest,
    };
  }
  // A label from the phone's contacts: its people.
  const labelProfile = (G, n) => ({ type: 'label', node: n, name: n.key, people: (G.ctx.byLabel.get(n.key) || []).map((p) => G.ctx.personNode.get(p)).sort(byWeight) });
  // You: the archive in numbers, the years, the people with the most
  // messages, the topics more than one person shares, the groups, and your
  // likely birthday.
  function youProfile(G, n) {
    const X = G.ctx;
    const all = X.rows.map((r) => X.cache.get(r)).filter(Boolean);
    const firsts = all.map((a) => a.first?.d).filter(Boolean).sort();
    const lasts = all.map((a) => a.last).filter(Boolean).sort();
    const years = new Map();
    let media = 0;
    for (const r of X.rows) {
      const a = X.cache.get(r);
      if (!a || !X.inCal(r)) continue;
      media += (a.kinds.p || 0) + (a.kinds.v || 0);
      for (const [y, [rc, s]] of Object.entries(a.years)) { const v = years.get(y) || [0, 0]; v[0] += s; v[1] += rc; years.set(y, v); }
    }
    const totals = { chats: X.rows.length, messages: all.reduce((t, a) => t + a.sent + a.recv, 0), first: firsts[0] || null, last: lasts[lasts.length - 1] || null, twoWay: X.two.list.length, oneWay: X.oneWayP.size, media };
    const people = X.two.list.map((p) => X.personNode.get(p)).sort(byWeight).slice(0, 25).map((q) => ({ node: q, n: q.w }));
    const topics = G.byType.topic.map((id) => G.nodes.get(id)).sort((a, b) => b.people - a.people || byWeight(a, b)).slice(0, 20).map((t) => ({ node: t, people: t.people }));
    const groups = G.byType.group.slice(0, 10).map((id) => G.nodes.get(id)).map((g) => ({ node: g, n: g.w }));
    return { type: 'you', node: n, totals, years: [...years].sort(([a], [b]) => cmp(a, b)).map(([y, [s, rc]]) => ({ y, sent: s, recv: rc, topics: (X.yearTopics.get(y) || []).slice(0, 3) })), people, topics, groups, mine: G.mine };
  }

  // ---------- search ----------
  // The nodes called something: by name (without case, accents or
  // punctuation; a person's other names and handle too), or by the digits
  // of a number. An exact name first, then the heaviest; `limit` of them.
  function search(G, text, limit = 10) {
    const G0 = L();
    const q = G0.nameKey(text);
    const digits = String(text || '').replace(/\D/g, '');
    const hits = [];
    for (const n of G.nodes.values()) {
      if (n.type === 'you') continue;
      const key = G0.nameKey(n.label);
      let hit = !!q && key.includes(q);
      if (!hit && n.type === 'person') {
        const p = n.ref;
        hit = (!!q && ((p.names || []).some((x) => G0.nameKey(x).includes(q)) || (n.sub && G0.nameKey(n.sub).includes(q)))) || (digits.length >= 3 && p.ids.some((i) => i.startsWith('tel:') && i.slice(4).includes(digits)));
      }
      if (hit) hits.push({ n, exact: key === q ? 0 : 1 });
    }
    return hits.sort((x, y) => x.exact - y.exact || byWeight(x.n, y.n)).slice(0, limit).map((x) => x.n);
  }

  return { build, ego, layout, profile, search, CAPS, TYPES };
})();
