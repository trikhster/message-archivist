// Usage: node test/perf/bench.mjs extension/library.js
// Benchmarks the per-pass and per-save costs of a backup on a 100,000-message chat.
import { readFileSync } from 'node:fs';
new Function(readFileSync(process.argv[2], 'utf8'))();
const G = globalThis.GMLib;
const people = ['Alice Test', 'Me'];
const words = 'see you soon ok sounds good running late dinner tonight call me later love this the flight lands at six'.split(' ');
const make = (n, startDay) => Array.from({ length: n }, (_, i) => {
  const t = new Date(Date.UTC(2022, 0, 1) + (startDay * 86400 + i * 1230) * 1000);
  const ts = t.toISOString().slice(0, 16).replace('T', ' ');
  const sent = i % 3 === 0;
  return { index: i + 1, id: `m${startDay}-${i}`, direction: sent ? 'sent' : 'received', sender: sent ? 'Me' : people[0], timestamp: ts, timestamp_precision: 'message', timestamp_raw: ts,
    text: Array.from({ length: 4 + (i % 9) }, (_, k) => words[(i + k) % words.length]).join(' '), media: i % 40 === 0 ? [{ kind: 'image', file: `media/p${i}.jpg`, width: 640, height: 480, bytes: 40000, source: 'full-size viewer', sha256: 'ab'.repeat(32) }] : [],
    accessibility_label: 'label' };
});
const time = (label, fn, reps = 1) => { const t0 = performance.now(); let r; for (let i = 0; i < reps; i++) r = fn(); const ms = (performance.now() - t0) / reps; console.log(`${label.padEnd(58)} ${ms.toFixed(1).padStart(8)} ms`); return r; };
const saved = make(100000, 400);            // already saved: newer
const older = make(50, 0).map((m) => ({ ...m, id: `old-${m.id}` }));   // a batch from scrolling back: older
const page = [...older, ...saved.slice(0, 450)];  // what's on the page
console.log(`chat: ${saved.length.toLocaleString()} messages\n`);

time('4.x  unknownIn(saved, page)  (every pass)', () => G.unknownIn(saved, page), 5);
const ids = new Set(saved.map((r) => r.id)); const sigs = new Set(saved.map(G.sigOf));
time('5.0  unknown(page) with kept sets  (every pass)', () => page.filter((m) => !(m.id && ids.has(m.id)) && !sigs.has(G.sigOf(m))), 5);
time('4.x  mergeChrono(saved, olderBatch)  (each batch)', () => G.mergeChrono(saved, older, page), 3);
time('5.0  prepend + renumber in place  (each batch)', () => { const out = [...older, ...saved]; out.forEach((r, k) => { r.index = k + 1; }); return out; }, 3);
time('5.0  rebuilding the kept sets after a merge', () => { new Set(saved.map((r) => r.id)); new Set(saved.map(G.sigOf)); }, 3);
time('checkChat (4.x: every 15 s; 5.0: only when compacting)', () => G.checkChat(saved, { history_complete: true, newest_check: { all_saved: true, on_screen: 30 } }, null), 3);
const data = { conversation: 'Test', messages: saved };
const pretty = time('4.x  JSON.stringify(messages.json, null, 2)', () => JSON.stringify(data, null, 2));
const compactJ = time('5.0  JSON.stringify(messages.json)', () => JSON.stringify(data));
console.log(`\nmessages.json size: 4.x ${(pretty.length / 1e6).toFixed(1)} MB, 5.0 ${(compactJ.length / 1e6).toFixed(1)} MB`);
console.log(`compaction: 4.x every 180 s; 5.0 every ${Math.round(Math.max(180000, saved.length * 20) / 60000)} min for this chat`);
