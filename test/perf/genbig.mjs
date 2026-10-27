// Usage: node test/perf/genbig.mjs extension/library.js <out folder> <any small .png>
// A synthetic library: one chat of ~100,000 messages over 4 years with ~2,900
// photos, plus 299 smaller chats. All names and numbers are made up.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const [lib, out, png] = process.argv.slice(2);
new Function(readFileSync(lib, 'utf8'))();
const G = globalThis.GMLib;
const words = 'see you soon ok sounds good running late dinner tonight call me later love this the flight lands at six pizza or tacos happy birthday did you see the game'.split(' ');
const files = [];
const w = (p, d) => { mkdirSync(join(out, p, '..'), { recursive: true }); writeFileSync(join(out, p), d); files.push(p); };
const rows = [];
function chat(n, title, number, days, photosEvery) {
  const folder = `conversations/${G.safeName(title)}`;
  const msgs = [];
  const start = Date.UTC(2022, 9, 1);
  for (let i = 0; i < n; i++) {
    const t = new Date(start + Math.floor((i / n) * days * 86400) * 1000);
    const ts = t.toISOString().slice(0, 16).replace('T', ' ');
    const sent = (i * 7) % 3 === 0;
    const media = [];
    if (photosEvery && i % photosEvery === 0) {
      const file = `media/${ts.replace(':', '.')} - ${sent ? 'Me' : title} ${i}.png`;
      copyFileSync(png, (mkdirSync(join(out, folder, 'media'), { recursive: true }), join(out, folder, file)));
      files.push(`${folder}/${file}`);
      media.push({ kind: 'image', file, width: 8, height: 8, bytes: 1870, source: i % (photosEvery * 3) === 0 ? 'chat thumbnail' : 'full-size viewer', sha256: 'ab'.repeat(32) });
    }
    msgs.push({ index: i + 1, id: `${number}-${i}`, direction: sent ? 'sent' : 'received', sender: sent ? 'Me' : title, timestamp: ts, timestamp_precision: 'message', timestamp_raw: ts, section: ts.slice(0, 10),
      text: Array.from({ length: 3 + (i % 11) }, (_, k) => words[(i * 3 + k) % words.length]).join(' '), media, accessibility_label: `${sent ? 'You' : title} said: …` });
  }
  const contact = { captured_at: new Date().toISOString(), end_to_end_encrypted: true, people: [{ name: title, number, photo: null }] };
  const data = { conversation: title, conversation_id: number.replace(/\D/g, ''), url: '', exported_at: new Date().toISOString(), participants: [title, 'Me'], message_count: n, messages: msgs, contact };
  const progress = { complete: true, history_complete: true, message_count: n, oldest: msgs[0]?.timestamp, newest: msgs[n - 1]?.timestamp, updated_at: new Date().toISOString(), start: { method: 'synthetic', detail: 'Generated test data' }, newest_check: { all_saved: true, on_screen: 30, at: new Date().toISOString() } };
  progress.checks = G.checkChat(msgs, progress, contact);
  w(`${folder}/messages.json`, JSON.stringify(data));
  w(`${folder}/progress.json`, JSON.stringify(progress));
  w(`${folder}/chat.js`, G.chatScript(folder, G.compactMessages(folder, msgs)));
  w(`${folder}/messages.csv`, G.chatCsv(title, folder, msgs));
  const mi = G.mediaIndex(msgs, folder);
  w(`${folder}/media-index.json`, JSON.stringify({ conversation: title, items: mi, counts: G.mediaCounts(mi.map((r) => r.status)) }));
  rows.push(G.summarize({ id: data.conversation_id, title, folder, data, progress }));
}
chat(100000, 'Partner Test', '(555) 010-0001', 4 * 365, 34);
for (let k = 2; k <= 300; k++) chat(50 + ((k * 137) % 2000), `Contact ${String(k).padStart(3, '0')}`, `(555) 010-${String(k).padStart(4, '0')}`, 30 + (k % 1400), k % 4 ? 0 : 400);
const now = new Date().toISOString();
w('data.js', G.indexScript({ exported_at: now, updated_at: now, info: { tool: 'Message Archivist', version: '0.0.1.0', runs: [] }, conversations: rows, skipped: [], verification: G.verificationOf(rows, null, '0.0.1.0').summary }));
w('export-info.json', JSON.stringify({ created_at: now, updated_at: now, runs: [] }));
writeFileSync(join(out, 'files.json'), JSON.stringify(files));
console.log(`${rows.length} chats, ${rows.reduce((n, r) => n + r.count, 0).toLocaleString()} messages, ${files.filter((f) => f.endsWith('.png')).length.toLocaleString()} photos, ${files.length.toLocaleString()} files`);
