// Compares two gm-restore packages chat by chat (matched by their addresses):
// every message's date, direction, text and sender, and each part's bytes.
// Prints only counts and positions, never message text.
// node test/restore/compare.mjs original.tar backup.tar
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function readTar(path) {
  const buf = readFileSync(path);
  const entries = new Map();
  for (let pos = 0; pos + 512 <= buf.length;) {
    const h = buf.subarray(pos, pos + 512);
    if (h.every((b) => b === 0)) break;
    const str = (o, l) => { const s = h.subarray(o, o + l); const z = s.indexOf(0); return s.subarray(0, z < 0 ? l : z).toString('utf8'); };
    const name = (str(345, 155) ? `${str(345, 155)}/` : '') + str(0, 100);
    const size = parseInt(str(124, 12).trim() || '0', 8);
    entries.set(name, buf.subarray(pos + 512, pos + 512 + size));
    pos += 512 + Math.ceil(size / 512) * 512;
  }
  const manifest = JSON.parse(entries.get('manifest.json').toString('utf8'));
  return { entries, manifest };
}

const [a, b] = [readTar(process.argv[2]), readTar(process.argv[3])];
const key = (t) => [...t.addresses].sort().join(',');
const lines = (pkg, t) => pkg.entries.get(t.file).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const sha = (pkg, f) => createHash('sha256').update(pkg.entries.get(f) || Buffer.alloc(0)).digest('hex').slice(0, 12);
const sig = (pkg, m) => [m.date, m.box, m.text || '', m.from || '', (m.parts || []).map((p) => `${p.ct}:${sha(pkg, p.file)}`).join('+')].join('|');

console.log('original:', JSON.stringify(a.manifest.counts));
console.log('backup:  ', JSON.stringify(b.manifest.counts), b.manifest.stopped ? '(stopped)' : '');
const bt = new Map(b.manifest.threads.map((t) => [key(t), t]));
let same = 0, diff = 0, missingChats = 0;
for (const t of a.manifest.threads) {
  const o = bt.get(key(t));
  if (!o) { missingChats++; console.log(`chat ${t.file} (${t.messages}): not in the backup`); continue; }
  bt.delete(key(t));
  const x = lines(a, t).map((m) => sig(a, m)).sort();
  const y = lines(b, o).map((m) => sig(b, m)).sort();
  const ys = new Map(); for (const s of y) ys.set(s, (ys.get(s) || 0) + 1);
  let missing = 0;
  for (const s of x) { const n = ys.get(s); if (n) ys.set(s, n - 1); else missing++; }
  const extra = [...ys.values()].reduce((n, v) => n + v, 0);
  if (missing || extra) { diff++; console.log(`chat ${t.file}: ${x.length} vs ${y.length}, ${missing} missing, ${extra} extra; group=${t.group}/${o.group}`); } else same++;
}
console.log(`${same} chats identical, ${diff} different, ${missingChats} missing, ${bt.size} only in the backup`);
