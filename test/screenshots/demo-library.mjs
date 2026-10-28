// A made-up library for the README's viewer screenshots: a group chat
// ("Family Group": Alice, Bob, Carol and me) with photos, some one-to-one
// texts, and WhatsApp and Telegram chats with the same people, so People
// and Contacts have something to show. Names, numbers and texts are invented.
// node test/screenshots/demo-library.mjs extension/library.js <out folder>
// Then copy extension/viewer.html (as index.html), viewer.js, theme.js and
// theme.css into the folder and serve it (see notes/Testing.md).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
const [lib, out] = process.argv.slice(2);
new Function(readFileSync(lib, 'utf8'))();
// The app modules, so the WhatsApp and Telegram chats are known as theirs.
const mods = join(dirname(lib), 'modules');
for (const f of readdirSync(mods).filter((f) => f.endsWith('.js')).sort()) new Function(readFileSync(join(mods, f), 'utf8'))();
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
const rows = [];
const APPS = { whatsapp: 'WhatsApp', telegram: 'Telegram' };
let rnd = 7; const r = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
let photoNo = 0;
// One made-up chat: `who` are the other people (one for a one-to-one chat).
function chat({ title, id, service, who, numbers = [], n, from, to, photos = 0, group = false, sentShare = 0.4 }) {
  const folder = service ? `conversations/${APPS[service]}/${G.safeName(title)}` : `conversations/${G.safeName(title)}`;
  const msgs = [];
  const step = (to - from) / (n - 1);
  let photo = 0;
  for (let i = 0; i < n; i++) {
    // More messages lately, as in a real chat: spread out at first, then a few a day.
    const x = i / (n - 1), jitter = (r() - 0.5) * step * 0.6 * (1 - x) ** 2;
    const at = i === n - 1 ? to : from + (to - from) * (1 - (1 - x) ** 1.8) + jitter;
    const ts = new Date(at).toISOString().slice(0, 16).replace('T', ' ');
    const sent = r() < sentShare;
    const sender = sent ? 'Me' : who[Math.floor(r() * who.length)];
    const media = [];
    let text = TEXTS[Math.floor(r() * TEXTS.length)];
    if (photo < photos && i % Math.max(2, Math.floor(n / photos)) === 1) {
      const [a, b] = PALETTE[photoNo++ % PALETTE.length];
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
  const people = who.map((name, k) => ({ name, ...(numbers[k] ? { number: numbers[k] } : {}) }));
  const contact = { captured_at: new Date().toISOString(), people };
  const data = { conversation: title, conversation_id: id, exported_at: new Date().toISOString(), participants: [...new Set(msgs.map((m) => m.sender))], message_count: n, messages: msgs, contact, ...(service ? { service } : {}), ...(group ? { group: true } : {}) };
  const progress = { complete: true, history_complete: true, message_count: n, start: { method: 'synthetic' }, newest_check: { all_saved: true, on_screen: 30 } };
  if (service) progress.status = 'imported';
  progress.checks = G.checkChat(msgs, progress, contact);
  w(`${folder}/messages.json`, JSON.stringify(data));
  w(`${folder}/progress.json`, JSON.stringify(progress));
  w(`${folder}/chat.js`, G.chatScript(folder, G.compactMessages(folder, msgs)));
  rows.push(G.summarize({ id, title, folder, data, progress }));
  return photo;
}
const D = (y, m, d, h = 12, mi = 0) => Date.UTC(y, m - 1, d, h, mi);
const photos = chat({ title: 'Family Group', id: '1001', who: ['Alice', 'Bob', 'Carol'], numbers: ['(555) 010-0011', '(555) 010-0012', '(555) 010-0013'], n: 126, from: D(2024, 1, 2, 9, 14), to: D(2026, 10, 21, 14, 39), photos: 22, group: true, sentShare: 0.29 });
chat({ title: 'Alice', id: '1002', who: ['Alice'], numbers: ['(555) 010-0011'], n: 240, from: D(2023, 3, 4), to: D(2026, 10, 20, 19, 5), photos: 6 });
chat({ title: 'Bob', id: '1003', who: ['Bob'], numbers: ['(555) 010-0012'], n: 90, from: D(2024, 6, 1), to: D(2026, 10, 18, 8, 30), photos: 3 });
chat({ title: 'Dana Fox', id: '1004', who: ['Dana Fox'], numbers: ['(555) 010-0014'], n: 60, from: D(2025, 2, 10), to: D(2026, 10, 12, 17, 45), photos: 2 });
chat({ title: 'Evan Cole', id: '1005', who: ['Evan Cole'], numbers: ['(555) 010-0015'], n: 35, from: D(2025, 8, 3), to: D(2026, 9, 30, 21, 10) });
chat({ title: 'Carol', id: '1006', who: ['Carol'], numbers: ['(555) 010-0013'], n: 70, from: D(2022, 5, 9), to: D(2026, 8, 2, 18, 0), photos: 2 });
chat({ title: 'Carol', id: 'whatsapp:demo-1', service: 'whatsapp', who: ['Carol'], numbers: ['(555) 010-0013'], n: 150, from: D(2023, 9, 1), to: D(2026, 10, 19, 22, 0), photos: 5 });
chat({ title: 'Book club', id: 'whatsapp:demo-2', service: 'whatsapp', who: ['Dana Fox', 'Evan Cole', 'Gia Moss'], n: 80, from: D(2025, 1, 15), to: D(2026, 10, 15, 20, 0), group: true, sentShare: 0.25 });
chat({ title: 'Bob', id: 'telegram:demo-3', service: 'telegram', who: ['Bob'], numbers: ['(555) 010-0012'], n: 45, from: D(2024, 11, 2), to: D(2026, 10, 10, 13, 20), photos: 1 });
rows.sort((a, b) => String(b.last).localeCompare(String(a.last)));
const now = new Date().toISOString();
w('data.js', G.indexScript({ exported_at: now, updated_at: now, info: { tool: 'Message Archivist', version: '0.0.1.0', runs: [] }, conversations: rows, skipped: [], verification: G.verificationOf(rows, null, '0.0.1.0').summary }));
console.log(`${rows.length} chats, ${rows.reduce((t, x) => t + x.count, 0)} messages; Family Group has ${photos} photos`);
