// Puts the app together (notes/Modules/App.md) for GitHub Pages: the
// extension's Settings page (as the app's home page) and viewer, with every
// script and style they load, plus app/ (stand-ins for the extension APIs,
// the offline copy, the web app manifest, icons). Nothing is compiled: each
// page gets a few lines in <head> (the manifest, a content security policy,
// app.js first), sw.js gets the version and the list of files with their
// hashes, and SHA256SUMS.txt lists every file's SHA-256.
//   node scripts/build-app.mjs [folder]   (default dist/site; the app is <folder>/app/)
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

const EXT = 'extension';
const APP = 'app';
const out = process.argv[2] || join('dist', 'site');
const dest = join(out, 'app');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const files = new Map(); // path in the app → contents
const put = (path, data) => { files.set(path, typeof data === 'string' ? Buffer.from(data) : data); };

// The app's pages and the extension pages they're made from.
const PAGES = { 'index.html': 'options.html', 'viewer.html': 'viewer.html' };
// Nothing but this address, its files, and pictures made in the page (the
// backup's photos are read from the folder as blob: URLs, contact photos are data: URLs).
// Frames only of its own pages: Settings' Archive tab is the viewer.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data:",
  "media-src 'self' blob: data:", "font-src 'self' data:", "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'",
  "frame-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');
const HEAD = [
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
  '<link rel="manifest" href="manifest.webmanifest">',
  '<meta name="theme-color" content="#f8fafd" media="(prefers-color-scheme: light)">',
  '<meta name="theme-color" content="#1b1b1c" media="(prefers-color-scheme: dark)">',
  '<script src="app.js"></script>',
];

const errors = [];
for (const [page, from] of Object.entries(PAGES)) {
  let html = readFileSync(join(EXT, from), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html)) errors.push(`${from} has an inline <script>`);
  // Everything the page loads comes along (data.js is the backup's own, read only from disk).
  for (const [, src] of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^":#?]+)"/g)) {
    if (src === 'data.js') continue;
    if (!existsSync(join(EXT, src))) errors.push(`${from} loads missing file: ${src}`);
    else put(src, readFileSync(join(EXT, src)));
  }
  const head = HEAD.filter((line) => !(line.startsWith('<meta name="viewport"') && /name="viewport"/.test(html)));
  html = html.replace(/<meta charset="utf-8">/i, (m) => `${m}\n${head.join('\n')}`);
  if (page === 'index.html') html = html.replace(/<title>[^<]*<\/title>/, '<title>Message Archivist</title>');
  put(page, html);
}
// What Settings copies into the backup folder beside index.html: the viewer
// as the extension ships it (MA_APP.archiveURL), and every file it loads
// (the app modules too), as GMLib.pageFiles finds them.
const viewer = readFileSync(join(EXT, 'viewer.html'), 'utf8');
put('archive/viewer.html', viewer);
for (const [, f] of viewer.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^":#?]+\.(?:js|css))"/g)) put(f, readFileSync(join(EXT, f)));

// The app's own files.
put('app.js', readFileSync(join(APP, 'app.js'), 'utf8').replace("'__VERSION__'", JSON.stringify(version)));
put('manifest.webmanifest', readFileSync(join(APP, 'manifest.webmanifest')));
for (const f of readdirSync(join(APP, 'icons'))) put(`icons/${f}`, readFileSync(join(APP, 'icons', f)));
if (!files.get('app.js').includes(JSON.stringify(version))) errors.push('app.js has no version placeholder');
const manifest = JSON.parse(files.get('manifest.webmanifest'));
for (const icon of manifest.icons) if (!files.has(icon.src)) errors.push(`the manifest's icon ${icon.src} is missing`);

// The offline copy: every file and its hash, so a change to any file is a new version.
const list = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => [path, sha256(data).slice(0, 16)]);
list.unshift(['./', list.find(([p]) => p === 'index.html')[1]]);
const build = sha256(JSON.stringify(list)).slice(0, 12);
put('sw.js', readFileSync(join(APP, 'sw.js'), 'utf8').replace("'__VERSION__'", JSON.stringify(version)).replace('__FILES__', JSON.stringify(list)).replace('__BUILD__', build));

if (errors.length) {
  console.error(`✗ ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

// Write it all, with SHA256SUMS.txt (shasum -a 256 -c SHA256SUMS.txt in the folder checks a copy).
rmSync(out, { recursive: true, force: true });
for (const [path, data] of files) { mkdirSync(dirname(join(dest, path)), { recursive: true }); writeFileSync(join(dest, path), data); }
const sums = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, data]) => `${sha256(data)}  ${path}`).join('\n');
writeFileSync(join(dest, 'SHA256SUMS.txt'), `${sums}\n`);
writeFileSync(join(out, 'index.html'), '<!doctype html>\n<meta charset="utf-8">\n<title>Message Archivist</title>\n<meta http-equiv="refresh" content="0; url=app/">\n<p><a href="app/">Message Archivist</a></p>\n');
console.log(`✓ Message Archivist app v${version}: ${files.size} files in ${posix.join(out.split('\\').join('/'), 'app')} (build ${build})`);
