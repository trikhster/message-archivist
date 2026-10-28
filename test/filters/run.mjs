// Checks how chats are told apart as verification codes, promotions and spam,
// or other automated texts (GMLib.chatTraits, senderOf, chatKind,
// chatKindFor), and that nothing you've talked in, no group and no chat the
// owner kept is ever one of them. The cases in cases.json are shared with
// the Android app's ClutterTest, so both give the same answers. All senders,
// numbers and texts are invented.
// node test/filters/run.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

new Function(readFileSync(join('extension', 'library.js'), 'utf8'))();
const G = globalThis.GMLib;
const CASES = JSON.parse(readFileSync(join('test', 'filters', 'cases.json'), 'utf8'));

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failed++; };

// A sender from cases.json as a library row: its contact card, a group's two
// people, and another app's chat for one that isn't texts.
const rowOf = (c) => ({
  id: `c-${c.name}`, folder: `conversations/${c.name}`, title: c.name, ...(c.texts === false ? { service: 'whatsapp' } : {}),
  contact: { people: c.group ? [{ n: 'A', num: '5550100101' }, { n: 'B', num: '5550100102' }] : [{ n: c.name, ...(c.number ? { num: c.number } : {}) }] },
});
const recordsOf = (lines) => lines.map(([who, text]) => ({ direction: who === 'me' ? 'sent' : 'received', sender: who === 'me' ? 'Me' : 'X', text }));

// ---------- the shared cases ----------
for (const m of CASES.messages) {
  const t = G.chatTraits(recordsOf([['in', m.text]]));
  const got = { code: t.codes === 1, promo: t.promos === 1, link: t.links === 1, scam: t.scams === 1 };
  const wrong = Object.keys(got).filter((k) => k in m && got[k] !== m[k]);
  check(`message: "${m.text.slice(0, 48)}"`, !wrong.length, wrong.map((k) => `${k} ${got[k]}`).join(', '));
}
for (const s of CASES.senders) check(`sender: ${s.name} is ${s.is}`, G.senderOf(rowOf(s)) === s.is, G.senderOf(rowOf(s)));
for (const c of CASES.chats) {
  const kind = G.chatKind(rowOf(c), G.chatTraits(recordsOf(c.messages)));
  check(`chat: ${c.about}: ${c.is || 'nothing'}`, kind === c.is, String(kind));
}

// ---------- only in the extension ----------
{
  const mine = G.chatTraits([{ direction: 'sent', text: 'hi' }, { d: 1, x: 'compact, sent' }, { x: 'compact, received 123456 code' }]);
  check('your messages are counted apart, in both record shapes', mine.sent === 2 && mine.received === 1 && mine.codes === 1, JSON.stringify(mine));
  check('an older index row with no traits: nothing', G.chatKind({ title: '72727', contact: { people: [{ n: '72727', num: '72727' }] } }) === null);
  const row = { ...rowOf({ name: '72727', number: '72727' }), traits: G.chatTraits(recordsOf([['in', 'Your code is 123456']])) };
  check('kept ("It\'s not"): nothing', G.chatKindFor(row, { keep: { [row.id]: true } }) === null);
  check('labelled Family: nothing', G.chatKindFor(row, { chats: { [row.id]: ['family'] } }) === null);
  const sam = { ...rowOf({ name: 'Sam Rivers', number: '+15550100101' }), traits: G.chatTraits(recordsOf([['in', 'hello']])) };
  check('labelled Spam: Promotions and spam', G.chatKindFor(sam, { chats: { [sam.id]: ['spam'] } }) === 'promos');
  check('no labels: as detected', G.chatKindFor(row, null) === 'codes');
  const s = G.skipKinds({ skipCodes: true, skipPromos: false, skipAutomated: true });
  check('which kinds Settings leaves out', s.has('codes') && !s.has('promos') && s.has('automated') && G.skipKinds(G.normalizeSettings({})).size === 0);
  const sum = G.summarize({ id: 'x', title: '72727', folder: 'conversations/72727', data: { messages: recordsOf([['in', 'Your code is 123456']]) } });
  check('the index keeps each chat\'s traits', sum.traits?.codes === 1 && sum.traits.received === 1);
  // A row counted by older rules (no `v`, or another) is counted again where it's used; one counted now isn't.
  check('traits from older rules are told apart', G.traitsCurrent(sum.traits) && !G.traitsCurrent({ sent: 0, received: 1 }) && !G.traitsCurrent({ v: 1 }) && !G.traitsCurrent(undefined));
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
