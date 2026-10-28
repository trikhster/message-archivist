// Writes notes/Code map.canvas, an Obsidian Canvas of the whole project: the
// features at the top (Google Messages, WhatsApp, Snapchat, phone restore…),
// each wired to the code that does it, and below them every file, its
// sections (the "// ---------- name ----------" comments) and every
// function in them, with the first sentence of the comment above it.
// gm-* messages between files are drawn as edges.
//   npm run code-map            rewrite the canvas
//   npm run code-map -- --check  only say whether it's out of date
// Nodes and edges added by hand in Obsidian (any id not starting "g-") are
// kept, and feature cards keep where they were dragged; the rest is laid out
// again each time. See notes/Code map.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'notes/Code map.canvas';
const KT = 'android/app/src/main/java/io/github/trikhster/messagearchivist';
const ls = (dir, ext) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort().map((f) => join(dir, f)) : []);
// One file per app's exports, and the registry that picks between them; found
// wherever they are (they're moving from importers/ to modules/ and import.js).
const APPS_DIR = existsSync('extension/modules') ? 'extension/modules' : 'extension/importers';
const REGISTRY = existsSync('extension/import.js') ? 'extension/import.js' : 'extension/importers/importers.js';
const APP_FILES = ls(APPS_DIR, '.js').filter((f) => f !== REGISTRY);
// Readers of an app's web page (web/<app>.js), for what its export leaves out.
const WEB_FILES = ls('extension/web', '.js');

// The rows of the map. Colours are Obsidian's: 1 red, 2 orange, 3 yellow, 4 green, 5 cyan, 6 purple.
const AREAS = [
  { id: 'core', label: 'Extension: backing up Google Messages', color: '5', files: ['extension/content.js', 'extension/writer.js', 'extension/background.js', 'extension/zip.js'] },
  { id: 'shared', label: 'Shared: the library and Obsidian notes', color: '4', files: ['extension/library.js', 'extension/obsidian.js'] },
  { id: 'pages', label: 'Extension pages: popup, Settings, viewer', color: '6', files: ['extension/popup.js', 'extension/options.js', 'extension/viewer.js', 'extension/theme.js'] },
  { id: 'import', label: "Importers: other apps' exports and web pages", color: '2', files: [REGISTRY, ...APP_FILES, ...WEB_FILES] },
  { id: 'app', label: 'The installable app and tooling', color: '3', files: ['app/app.js', 'app/sw.js', ...ls('scripts', '.mjs')] },
  { id: 'android', label: 'Android app', color: '1', files: ls(KT, '.kt') },
];

// The module note for each file, linked from its group.
const NOTES = {
  'extension/content.js': 'Content script', 'extension/writer.js': 'Writer frame', 'extension/background.js': 'Background worker',
  'extension/zip.js': 'Small files', 'extension/library.js': 'Library module', 'extension/obsidian.js': 'Obsidian notes',
  'extension/popup.js': 'Popup', 'extension/options.js': 'Settings page', 'extension/viewer.js': 'Viewer', 'extension/theme.js': 'Small files',
  'app/app.js': 'App', 'app/sw.js': 'App', 'scripts/build-app.mjs': 'App', 'scripts/serve-app.mjs': 'App',
  'scripts/code-map.mjs': 'Code map', 'scripts/check.mjs': 'Testing', 'scripts/package.mjs': 'Releasing', 'scripts/set-version.mjs': 'Releasing',
  'extension/web/snapchat.js': 'Snapchat Web page',
};
const noteFor = (file) => NOTES[file] || (file === REGISTRY || APP_FILES.includes(file) || WEB_FILES.includes(file) ? 'Importers' : file.startsWith('android/') ? 'Android app' : null);

// The features, top of the map. Targets: a file, "file#section" or "file:function".
const K = (f) => `${KT}/${f}`;
// A card for each app file; an app not listed here still gets one, with its file name.
const APPS = {
  whatsapp: ['WhatsApp', 'A chat’s “Export chat” .txt or .zip.'],
  telegram: ['Telegram', 'Telegram Desktop’s JSON export.'],
  discord: ['Discord', 'Discord’s data package.'],
  meta: ['Instagram and Messenger', 'Meta’s “Download your information” JSON.'],
  tiktok: ['TikTok', 'TikTok’s data download.'],
  snapchat: ['Snapchat', 'Snapchat’s “My Data” download.'],
  imessage: ['iMessage', 'Messages on a Mac.'],
  signal: ['Signal', 'Signal’s chats.'],
};
const SEGMENTS = [
  { id: 'messages', title: 'Google Messages backup', color: '5', note: 'Backup run', text: 'Reads chats out of messages.google.com and writes them into the backup folder, one chat or all of them.',
    to: ['extension/content.js#entry points', 'extension/content.js#resumable backup of one conversation', 'extension/content.js#back up everything', 'extension/writer.js'] },
  { id: 'schedules', title: 'Automatic backups', color: '5', note: 'Background worker', text: 'Alarms from every hour to every 30 days run the due chats in the Messages tab.',
    to: ['extension/background.js#schedules', 'extension/background.js#keeping Google Messages working on its own'] },
  { id: 'photos', title: 'Photos and media', color: '5', note: 'Photo statuses and runs', text: 'Fetching, full-size upgrades, duplicates and every picture’s status.',
    to: ['extension/content.js#media', 'extension/library.js#every picture\'s status', 'extension/library.js#the same picture twice', 'extension/options.js#duplicate photos'] },
  { id: 'library', title: 'The library on disk', color: '4', note: 'Library format', text: 'Per-chat files, the index (data.js), merging, completeness checks and checksums.',
    to: ['extension/library.js#per-chat files', 'extension/library.js#the index (data.js)', 'extension/library.js#merging', 'extension/library.js#completeness checks'] },
  { id: 'people', title: 'People across apps', color: '4', note: 'Sources', text: 'One person across apps, accounts and numbers; leaving codes and automated texts out.',
    to: ['extension/library.js#people: one person across apps, accounts and numbers', 'extension/library.js#codes, promotions and automated texts', 'extension/viewer.js#people'] },
  ...APP_FILES.map((file) => {
    const id = file.split('/').pop().replace(/\.js$/, '');
    const [title, text] = APPS[id] || [id, 'Reads this app’s export into library chats.'];
    return { id, title, color: '2', note: 'Importers', text, to: [file] };
  }),
  // A card for each app's web page reader, wired to where its captures go.
  ...WEB_FILES.map((file) => {
    const id = file.split('/').pop().replace(/\.js$/, '');
    return { id: `${id}-web`, title: `${(APPS[id] || [id])[0]} for Web`, color: '2', note: noteFor(file),
      text: 'Reads the chats the owner opens on the app’s web page, for what its export leaves out; kept until brought in.',
      to: [file, 'extension/background.js#captures from apps\' web pages', 'extension/import.js:webSource', 'extension/options.js#apps'] };
  }),
  { id: 'imports', title: 'Bringing in exports', color: '2', note: 'Sources', text: 'Recognises an export, runs its importer and merges the chats in.',
    to: [REGISTRY, 'extension/options.js#bring in conversations from other apps', 'extension/options.js#import earlier exports'] },
  { id: 'settings', title: 'Settings', color: '6', note: 'Settings page', text: 'The folder, backup health, schedules, deleting chats.',
    to: ['extension/options.js#the settings form', 'extension/options.js#every chat (the backup index)', 'extension/options.js#deleting a chat from the backup'] },
  { id: 'viewer', title: 'Archive viewer', color: '6', note: 'Viewer', text: 'Reading, searching and analysing the archive offline.',
    to: ['extension/viewer.js#chat view', 'extension/viewer.js#global search', 'extension/viewer.js#analysis'] },
  { id: 'obsidian', title: 'Notes for Obsidian', color: '4', note: 'Obsidian notes', text: 'The archive as an Obsidian vault.', to: ['extension/obsidian.js', 'extension/options.js#Obsidian'] },
  { id: 'webapp', title: 'The installable app', color: '3', note: 'App', text: 'Settings and the viewer as a web app on Chrome or Edge.', to: ['app/app.js', 'scripts/build-app.mjs'] },
  { id: 'restore', title: 'Android restore', color: '1', note: 'Restore package', text: 'Settings writes a restore package; the phone app writes it into the SMS/MMS database.',
    to: ['extension/library.js#the restore package', 'extension/options.js#a copy for restoring to a phone', K('RestorePackage.kt'), K('Restorer.kt'), K('RestoreService.kt'), K('DefaultSmsParts.kt')] },
  { id: 'phonebackup', title: 'Android phone backup', color: '1', note: 'Android app', text: 'The phone backs itself up into the same format, once or every day.',
    to: [K('PhoneBackup.kt'), K('BackupFiles.kt'), 'extension/library.js#phone backups'] },
];

// ---------- reading the code ----------

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with', 'else', 'do', 'try', 'new', 'typeof', 'await']);
const SECTION = /^(\s*)\/\/ -{3,} (.+?) -{3,}\s*$/;

// The comment just above line i, as one line; section headers aren't comments about it.
function commentAbove(lines, i) {
  const out = [];
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t.startsWith('@')) continue;
    if (SECTION.test(lines[j]) || !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'))) break;
    out.unshift(t.replace(/^\/\*\*?|\*\/$|^\*|^\/\//g, '').trim());
  }
  const text = out.filter(Boolean).join(' ');
  const first = text.match(/^.+?[.!?](?=\s|$)/)?.[0] || text;
  return first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first;
}

const shortParams = (p) => {
  if (p == null) return '…';
  p = p.replace(/\s+/g, ' ').trim();
  return p.length > 36 ? p.slice(0, 35) + '…' : p;
};

// Functions at the level each section sits at (and object methods one level in),
// so helpers nested inside a function stay out of the map.
function readJs(src) {
  const lines = src.split('\n');
  const found = [];
  let section = null;
  lines.forEach((line, i) => {
    const s = line.match(SECTION);
    if (s) { section = { name: s[2], indent: s[1].length }; return; }
    let m;
    if ((m = line.match(/^(\s*)(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(([^)]*)\)?/))) found.push({ indent: m[1].length, name: m[2], params: m[3], kind: 'fn', i, section });
    // const x = (() => { … })(): a value built once, not a function to call.
    else if ((m = line.match(/^(\s*)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*\(\s*(?:async\s*)?(?:\([^()]*\)\s*=>|function\b)/))) found.push({ indent: m[1].length, name: m[2], params: null, kind: 'iife', i, section });
    else if ((m = line.match(/^(\s*)(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function\b[^(]*\(([^)]*)\)|\(([^)]*)\)\s*=>|(\w+)\s*=>)/))) found.push({ indent: m[1].length, name: m[2], params: m[3] ?? m[4] ?? m[5], kind: 'fn', i, section });
    else if ((m = line.match(/^(\s*)class\s+(\w+)/))) found.push({ indent: m[1].length, name: m[2], params: null, kind: 'class', i, section });
    else if ((m = line.match(/^(\s+)(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\(([^)]*)\)\s*\{/)) && !KEYWORDS.has(m[2])) found.push({ indent: m[1].length, name: m[2], params: m[3], kind: 'method', i, section });
  });
  const fileBase = Math.min(...found.filter((f) => f.kind !== 'method').map((f) => f.indent));
  return found
    .filter((f) => {
      const base = f.section ? f.section.indent : fileBase;
      return f.indent === base || (f.kind === 'method' && f.indent === base + 2);
    })
    .map((f) => ({ section: f.section?.name || 'top level', name: f.name, sig: f.kind === 'class' ? `class ${f.name}` : f.kind === 'iife' ? `${f.name} = (…)()` : `${f.name}(${shortParams(f.params)})`, about: commentAbove(lines, f.i) }));
}

// Top-level functions and the members of top-level classes and objects, grouped by class and section.
function readKotlin(src) {
  const lines = src.split('\n');
  const found = [];
  let owner = null;
  let header = null;
  lines.forEach((line, i) => {
    const s = line.match(SECTION);
    if (s) { header = s[2]; return; }
    let m;
    if ((m = line.match(/^(?:(?:private|internal|public|data|enum|sealed|abstract|open)\s+)*(class|object|interface)\s+(\w+)/))) {
      // A body opens on this line, or after a constructor that runs over several lines.
      const open = (line.match(/\(/g) || []).length > (line.match(/\)/g) || []).length;
      owner = /\{\s*$/.test(line) || open ? m[2] : null;
      header = null;
      found.push({ section: header || 'top level', sig: `${m[1]} ${m[2]}`, name: m[2], about: commentAbove(lines, i) });
      return;
    }
    if (/^\}/.test(line)) { owner = null; header = null; return; }
    if ((m = line.match(/^(\s*)(?:(?:private|internal|public|protected|override|suspend|inline|operator|open|abstract)\s+)*fun\s+(?:<[^>]+>\s+)?(?:[\w.]+\.)?(\w+)\s*\(([^)]*)(\))?/))) {
      const indent = m[1].length;
      if (indent !== 0 && !(owner && indent === 4)) return;
      const section = indent === 0 ? header || 'top level' : header ? `${owner} · ${header}` : owner;
      found.push({ section, name: m[2], sig: `${m[2]}(${m[4] ? shortParams(m[3]) : '…'})`, about: commentAbove(lines, i) });
    }
  });
  return found;
}

// gm-* messages: which files send each one, and which handle it.
function messages(files) {
  const sends = new Map();
  const handles = new Map();
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const src = readFileSync(file, 'utf8');
    for (const [, t] of src.matchAll(/type:\s*'(gm-[\w-]+)'/g)) (sends.get(t) || sends.set(t, new Set()).get(t)).add(file);
    for (const [, t] of src.matchAll(/case\s+'(gm-[\w-]+)'/g)) (handles.get(t) || handles.set(t, new Set()).get(t)).add(file);
  }
  const pairs = new Map();
  for (const [t, from] of sends) for (const a of from) for (const b of handles.get(t) || []) {
    if (a === b) continue;
    const key = `${a}→${b}`;
    (pairs.get(key) || pairs.set(key, { from: a, to: b, types: [] }).get(key)).types.push(t);
  }
  return [...pairs.values()];
}

// ---------- laying it out ----------

const CARD_W = 280;
const GAP = 20;
const PAD = 30; // inside a group, and room for the label above the next one
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lineCount = (text) => text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 34)), 0);
const cardHeight = (text) => 24 + 24 * lineCount(text);

const nodes = [];
const edges = [];
const ids = new Map(); // "file", "file#section", "file:name" → node id
const usedIds = new Set();
const uniqueId = (base) => {
  let id = base;
  for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
  usedIds.add(id);
  return id;
};

// Cards in a grid, rows as tall as their tallest card; returns the size used.
function grid(cards, x0, y0, cols) {
  let y = y0;
  for (let r = 0; r < cards.length; r += cols) {
    const row = cards.slice(r, r + cols);
    const h = Math.max(...row.map((c) => c.height));
    row.forEach((c, k) => Object.assign(c, { x: x0 + k * (CARD_W + GAP), y, height: h }));
    y += h + GAP;
  }
  return { width: Math.min(cols, cards.length) * (CARD_W + GAP) - GAP, height: y - y0 - GAP };
}

function layFile(file, x0, y0, color) {
  const items = file.endsWith('.kt') ? readKotlin(readFileSync(file, 'utf8')) : readJs(readFileSync(file, 'utf8'));
  const fileId = uniqueId(`g-${slug(file)}`);
  ids.set(file, fileId);
  const cols = items.length > 60 ? 3 : 2;
  const note = noteFor(file);
  const head = { id: uniqueId(`${fileId}-about`), type: 'text', text: `${note ? `[[${note}]] · ` : ''}${items.length} functions`, width: 0, height: 60 };
  const inner = [head];
  let y = y0 + PAD + head.height + GAP + PAD;
  let width = CARD_W;
  const sections = [...new Set(items.map((f) => f.section))];
  for (const name of sections) {
    const secId = uniqueId(`${fileId}-${slug(name)}`);
    ids.set(`${file}#${name}`, secId);
    const cards = items.filter((f) => f.section === name).map((f) => {
      const text = `\`${f.sig}\`${f.about ? `\n${f.about}` : ''}`;
      const id = uniqueId(`${secId}-${slug(f.name)}`);
      if (!ids.has(`${file}:${f.name}`)) ids.set(`${file}:${f.name}`, id);
      return { id, type: 'text', text, width: CARD_W, height: cardHeight(text) };
    });
    const size = grid(cards, x0 + 2 * PAD, y + PAD, Math.min(cols, cards.length));
    const sec = { id: secId, type: 'group', label: name, x: x0 + PAD, y, width: size.width + 2 * PAD, height: size.height + 2 * PAD };
    inner.push(sec, ...cards);
    width = Math.max(width, sec.width);
    y += sec.height + PAD + GAP;
  }
  Object.assign(head, { x: x0 + PAD, y: y0 + PAD, width });
  const group = { id: fileId, type: 'group', label: file, color, x: x0, y: y0, width: width + 2 * PAD, height: y - y0 };
  nodes.push(group, ...inner);
  return group;
}

// Feature cards across the top.
const segCards = SEGMENTS.map((s) => {
  const text = `## ${s.title}\n${s.text}\n[[${s.note}]]`;
  return { id: uniqueId(`g-seg-${s.id}`), type: 'text', text, color: s.color, width: 300, height: 60 + 24 * lineCount(`${s.title}\n${s.text}\n${s.note}`) };
});
const SEG_COLS = 9;
const title = { id: uniqueId('g-title'), type: 'text', x: 0, y: 0, width: 900, height: 120,
  text: '# Message Archivist: code map\nFeatures on top, wired to the code that does them. Below, every file, its sections and functions. Regenerate with `npm run code-map`; see [[Code map]].' };
nodes.push(title);
let y = title.height + 3 * PAD;
for (let r = 0; r < segCards.length; r += SEG_COLS) {
  const row = segCards.slice(r, r + SEG_COLS);
  const h = Math.max(...row.map((c) => c.height));
  row.forEach((c, k) => Object.assign(c, { x: k * (300 + 40), y, height: h }));
  y += h + 40;
}
nodes.push(...segCards);
y += 300; // room for the edges to fan out

// One row per area, its files side by side.
for (const area of AREAS) {
  const x0 = 0;
  const top = y;
  let x = x0 + PAD;
  let bottom = top;
  const areaNode = { id: uniqueId(`g-area-${area.id}`), type: 'group', label: area.label, color: area.color };
  nodes.push(areaNode);
  for (const file of area.files.filter(existsSync)) {
    const g = layFile(file, x, top + PAD, area.color);
    x += g.width + 2 * GAP;
    bottom = Math.max(bottom, g.y + g.height);
  }
  Object.assign(areaNode, { x: x0, y: top, width: x - x0 - 2 * GAP + PAD, height: bottom - top + PAD });
  y = bottom + PAD + 120;
}

// Feature → code.
const missing = [];
SEGMENTS.forEach((s, k) => {
  for (const target of s.to) {
    const to = ids.get(target);
    if (!to) { missing.push(`${s.title} → ${target}`); continue; }
    edges.push({ id: uniqueId(`g-e-${s.id}-${slug(target)}`), fromNode: segCards[k].id, fromSide: 'bottom', toNode: to, toSide: 'top', color: s.color });
  }
});

// File → file, for the gm-* messages one sends and the other handles.
for (const m of messages(AREAS.flatMap((a) => a.files))) {
  const from = ids.get(m.from);
  const to = ids.get(m.to);
  if (!from || !to) continue;
  const label = m.types.length > 4 ? `${m.types.slice(0, 4).join(', ')} +${m.types.length - 4}` : m.types.join(', ');
  edges.push({ id: uniqueId(`g-msg-${slug(m.from)}-${slug(m.to)}`), fromNode: from, toNode: to, label, color: '6' });
}

// ---------- keeping hand edits ----------

let old = { nodes: [], edges: [] };
if (existsSync(OUT)) {
  try { old = JSON.parse(readFileSync(OUT, 'utf8')); } catch { /* rewritten below */ }
}
const oldById = new Map(old.nodes.map((n) => [n.id, n]));
for (const n of nodes) {
  const was = oldById.get(n.id);
  if (n.id.startsWith('g-seg-') && was) Object.assign(n, { x: was.x, y: was.y, width: was.width, height: was.height });
}
const nodeIds = new Set(nodes.map((n) => n.id));
const handNodes = old.nodes.filter((n) => !n.id.startsWith('g-'));
handNodes.forEach((n) => nodeIds.add(n.id));
// A hand-drawn edge stays while both of its ends still exist.
const handEdges = (old.edges || []).filter((e) => !e.id.startsWith('g-') && nodeIds.has(e.fromNode) && nodeIds.has(e.toNode));

const canvas = JSON.stringify({ nodes: [...nodes, ...handNodes], edges: [...edges, ...handEdges] }, null, '\t') + '\n';
const fnCount = nodes.filter((n) => n.type === 'text' && n.text.startsWith('`')).length;

if (missing.length) console.warn(`! feature links to code that's gone (fix SEGMENTS in scripts/code-map.mjs):\n- ${missing.join('\n- ')}`);
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== canvas) {
    console.error(`✗ ${OUT} is out of date: run npm run code-map`);
    process.exit(1);
  }
  console.log(`✓ ${OUT} is up to date`);
} else {
  writeFileSync(OUT, canvas);
  console.log(`✓ ${OUT}: ${SEGMENTS.length} features, ${AREAS.reduce((n, a) => n + a.files.length, 0)} files, ${fnCount} functions, ${edges.length} edges${handNodes.length + handEdges.length ? `, ${handNodes.length + handEdges.length} hand-made kept` : ''}`);
}
if (missing.length) process.exitCode = 1;
