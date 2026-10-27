// Usage: node test/restore/gensmall.mjs extension/library.js <out folder> <any small .png>
// A small library to test the Android restore: one-to-one chat with photos and
// same-minute bursts, a group chat with photos, a short code without a contact
// card. All names and numbers are made up.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
const [lib, out, png] = process.argv.slice(2);
new Function(readFileSync(lib, 'utf8'))();
const G = globalThis.GMLib;
const files = [];
const w = (p, d) => { mkdirSync(join(out, p, '..'), { recursive: true }); writeFileSync(join(out, p), d); files.push(p); };
const rows = [];
function chat({ title, id, people, n, photoEvery, burst, senders }) {
  const folder = `conversations/${G.safeName(title)}`;
  const msgs = [];
  let t = Date.UTC(2024, 0, 1, 9, 0);
  for (let i = 0; i < n; i++) {
    t += (burst && i % 5 ? 0 : 3600) * 1000; // bursts: 5 messages in the same minute
    const ts = new Date(t).toISOString().slice(0, 16).replace('T', ' ');
    const sent = i % 3 === 0;
    const sender = sent ? 'Me' : senders[i % senders.length];
    const media = [];
    if (photoEvery && i % photoEvery === 1) {
      const file = `media/${ts.replace(':', '.')} - ${sender} ${i}.png`;
      mkdirSync(join(out, folder, 'media'), { recursive: true });
      copyFileSync(png, join(out, folder, file));
      files.push(`${folder}/${file}`);
      media.push({ kind: 'image', file, width: 8, height: 8, bytes: 1870, source: 'full-size viewer', sha256: 'ab'.repeat(32) });
    }
    msgs.push({ index: i + 1, id: `${id}-${i}`, direction: sent ? 'sent' : 'received', sender, timestamp: ts, timestamp_precision: 'message', timestamp_raw: ts, text: `${title} message ${i + 1}`, media });
  }
  const contact = people ? { captured_at: new Date().toISOString(), people } : null;
  const data = { conversation: title, conversation_id: id, exported_at: new Date().toISOString(), participants: [...new Set(msgs.map((m) => m.sender))], message_count: n, messages: msgs, ...(contact ? { contact } : {}) };
  const progress = { complete: true, history_complete: true, message_count: n, start: { method: 'synthetic' }, newest_check: { all_saved: true, on_screen: 30 } };
  progress.checks = G.checkChat(msgs, progress, contact);
  w(`${folder}/messages.json`, JSON.stringify(data));
  w(`${folder}/progress.json`, JSON.stringify(progress));
  w(`${folder}/chat.js`, G.chatScript(folder, G.compactMessages(folder, msgs)));
  rows.push(G.summarize({ id, title, folder, data, progress }));
}
chat({ title: 'Test Partner', id: '9001', people: [{ name: 'Test Partner', number: '+1 555-010-0001' }], n: 400, photoEvery: 40, burst: true, senders: ['Test Partner'] });
chat({ title: 'Test Group', id: '9002', people: [{ name: 'Ann Test', number: '+1 555-010-0002' }, { name: 'Ben Test', number: '+1 555-010-0003' }], n: 60, photoEvery: 15, senders: ['Ann Test', 'Ben Test'] });
chat({ title: '22395', id: '9003', people: null, n: 12, senders: ['22395'] });
chat({ title: 'No Number Friend', id: '9004', people: null, n: 5, senders: ['No Number Friend'] });
const now = new Date().toISOString();
w('data.js', G.indexScript({ exported_at: now, updated_at: now, info: { tool: 'Message Archivist', version: '0.0.1.0', runs: [] }, conversations: rows, skipped: [], verification: G.verificationOf(rows, null, '0.0.1.0').summary }));
writeFileSync(join(out, 'files.json'), JSON.stringify(files));
console.log(rows.map((r) => `${r.title}: ${r.count} messages, ${r.media_saved} photos`).join('\n'));
