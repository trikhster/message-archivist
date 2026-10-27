// A made-up library for the README's viewer screenshots: one group chat
// ("Family Group": Alice, Bob, Carol and me) with photos. Names, numbers
// and texts are invented.
// node test/screenshots/demo-library.mjs extension/library.js <out folder>
// Then copy extension/viewer.html (as index.html), viewer.js, theme.js and
// theme.css into the folder and serve it (see notes/Testing.md).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
const [lib, out] = process.argv.slice(2);
new Function(readFileSync(lib, 'utf8'))();
const G = globalThis.GMLib;
const w = (p, d) => { mkdirSync(join(out, p, '..'), { recursive: true }); writeFileSync(join(out, p), d); };
function png(width, height, [r1, g1, b1], [r2, g2, b2]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width * 3 + 1); const f = y / height;
    for (let x = 0; x < width; x++) {
      const k = o + 1 + x * 3; const g = (x / width + f) / 2;
      raw[k] = r1 + (r2 - r1) * g; raw[k + 1] = g1 + (g2 - g1) * g; raw[k + 2] = b1 + (b2 - b1) * g;
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PALETTE = [[[233, 120, 60], [250, 190, 90]], [[70, 130, 200], [150, 210, 240]], [[90, 170, 110], [200, 230, 150]], [[160, 90, 180], [240, 160, 200]]];
const TEXTS = ['call me later', 'running late 😅', 'ok sounds good', 'on my way', 'who’s bringing dessert?', 'I can pick up the cake', 'see you Sunday', 'happy birthday!! 🎉', 'did anyone see the game last night', 'lol yes', 'what time is dinner', '6:30 works', 'can someone grab milk', 'got it 👍', 'the kids loved it', 'miss you all', 'photos from the weekend', 'that’s great news', 'let me check', 'sure, I’ll be there', 'traffic is terrible', 'almost there', 'thanks for hosting', 'next time at ours', 'good morning ☀️', 'love this', 'haha', 'where should we meet?', 'the usual place?', 'perfect'];
const SENDERS = ['Alice', 'Bob', 'Carol'];
const title = 'Family Group', id = '1001', folder = `conversations/${G.safeName(title)}`;
const msgs = [];
let t = Date.UTC(2024, 0, 2, 9, 14);
const end = Date.UTC(2026, 9, 21, 14, 39);
const N = 126, step = (end - t) / (N - 1);
let rnd = 7; const r = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
let photo = 0;
for (let i = 0; i < N; i++) {
  const at = i === N - 1 ? end : t + step * i + (r() - 0.5) * step * 0.6;
  const ts = new Date(at).toISOString().slice(0, 16).replace('T', ' ');
  const sent = r() < 0.29;
  const sender = sent ? 'Me' : SENDERS[Math.floor(r() * 3)];
  const media = [];
  let text = TEXTS[Math.floor(r() * TEXTS.length)];
  if (i % 6 === 4 && photo < 22) {
    const [a, b] = PALETTE[photo % PALETTE.length];
    const file = `media/${ts.replace(':', '.')} - ${sender} ${i}.png`;
    const data = png(480, 360, a, b);
    w(`${folder}/${file}`, data);
    media.push({ kind: 'image', file, width: 480, height: 360, bytes: data.length, source: 'full-size viewer', sha256: 'cd'.repeat(32) });
    photo++;
    if (r() < 0.6) text = '';
  }
  msgs.push({ index: i + 1, id: `${id}-${i}`, direction: sent ? 'sent' : 'received', sender, timestamp: ts, timestamp_precision: 'message', timestamp_raw: ts, text, media });
}
msgs.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).forEach((m, i) => { m.index = i + 1; });
const people = [{ name: 'Alice', number: '(555) 010-0011' }, { name: 'Bob', number: '(555) 010-0012' }, { name: 'Carol', number: '(555) 010-0013' }];
const contact = { captured_at: new Date().toISOString(), people };
const data = { conversation: title, conversation_id: id, exported_at: new Date().toISOString(), participants: [...new Set(msgs.map((m) => m.sender))], message_count: N, messages: msgs, contact };
const progress = { complete: true, history_complete: true, message_count: N, start: { method: 'synthetic' }, newest_check: { all_saved: true, on_screen: 30 } };
progress.checks = G.checkChat(msgs, progress, contact);
w(`${folder}/messages.json`, JSON.stringify(data));
w(`${folder}/progress.json`, JSON.stringify(progress));
w(`${folder}/chat.js`, G.chatScript(folder, G.compactMessages(folder, msgs)));
const rows = [G.summarize({ id, title, folder, data, progress })];
const now = new Date().toISOString();
w('data.js', G.indexScript({ exported_at: now, updated_at: now, info: { tool: 'Message Archivist', version: '0.0.1.0', runs: [] }, conversations: rows, skipped: [], verification: G.verificationOf(rows, null, '0.0.1.0').summary }));
console.log(`${title}: ${N} messages, ${photo} photos`);
