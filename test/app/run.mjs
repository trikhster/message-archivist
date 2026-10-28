// Checks the app's build (scripts/build-app.mjs, notes/Modules/App.md): the
// pages get the manifest, the security policy and app.js first; the backup
// folder gets the viewer exactly as the extension ships it; the offline copy
// lists every file with its hash; the manifest is complete; nothing of the
// extension's own (its content script, background worker…) is served; and
// two builds are identical.
// node test/app/run.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : ` (${detail})`}`); if (!ok) failed++; };
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const tmp = mkdtempSync(join(tmpdir(), 'ma-app-'));
const build = (dir) => execFileSync(process.execPath, ['scripts/build-app.mjs', dir], { stdio: 'pipe' }).toString();
const walk = (dir, base = '') => readdirSync(join(dir, base)).flatMap((f) => (statSync(join(dir, base, f)).isDirectory() ? walk(dir, join(base, f)) : [join(base, f).split('\\').join('/')]));

try {
  build(join(tmp, 'a'));
  const app = join(tmp, 'a', 'app');
  const read = (p) => readFileSync(join(app, p), 'utf8');
  const files = walk(app).sort();
  check('the site sends visitors to the app', readFileSync(join(tmp, 'a', 'index.html'), 'utf8').includes('url=app/'));
  check('the app has its pages, stand-ins, offline copy, manifest and icons', ['index.html', 'viewer.html', 'app.js', 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'archive/viewer.html', 'SHA256SUMS.txt'].every((f) => files.includes(f)), files.join(', '));
  check('nothing of the extension\'s own is served', !files.some((f) => /^(content|background|writer|popup)\.|^manifest\.json$/.test(f)), files.join(', '));

  // The pages.
  for (const page of ['index.html', 'viewer.html']) {
    const html = read(page);
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    check(`${page}: app.js comes first`, scripts[0] === 'app.js', scripts.join(', '));
    check(`${page}: a content security policy that allows nothing but this address`, /<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self';[^"]*connect-src 'self'/.test(html));
    check(`${page}: the manifest`, html.includes('<link rel="manifest" href="manifest.webmanifest">'));
    check(`${page}: no inline scripts`, !/<script(?![^>]*\bsrc=)[^>]*>\s*\S/.test(html));
    const missing = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^":#?]+)"/g)].map((m) => m[1]).filter((f) => f !== 'data.js' && !files.includes(f));
    check(`${page}: everything it loads is there`, !missing.length, missing.join(', '));
  }
  check('the home page is called Message Archivist', read('index.html').includes('<title>Message Archivist</title>'));
  check('the backup folder gets the viewer as the extension ships it', read('archive/viewer.html') === readFileSync('extension/viewer.html', 'utf8'));
  check('…and the extension\'s own pages are untouched', !readFileSync('extension/viewer.html', 'utf8').includes('src="app.js"') && !readFileSync('extension/options.html', 'utf8').includes('src="app.js"'));
  check('app.js knows the version', read('app.js').includes(`const VERSION = ${JSON.stringify(version)};`));

  // The offline copy.
  const sw = read('sw.js');
  check('sw.js: no placeholders left', !/__(FILES|BUILD|VERSION)__/.test(sw));
  check('sw.js: the version', sw.includes(`const VERSION = ${JSON.stringify(version)};`));
  const list = JSON.parse(sw.match(/const FILES = (\[.*\]);/)[1]);
  const listed = new Map(list);
  const kept = files.filter((f) => f !== 'sw.js' && f !== 'SHA256SUMS.txt');
  check('sw.js: every file is kept for offline use', kept.every((f) => listed.has(f)) && listed.has('./'), kept.filter((f) => !listed.has(f)).join(', '));
  check('sw.js: only files that exist', [...listed.keys()].every((f) => f === './' || files.includes(f)));
  check('sw.js: each with its hash', kept.every((f) => listed.get(f) === sha256(readFileSync(join(app, f))).slice(0, 16)) && listed.get('./') === listed.get('index.html'));

  // The manifest.
  const m = JSON.parse(read('manifest.webmanifest'));
  check('manifest: name, its own id, start and scope', m.name === 'Message Archivist' && m.id && m.start_url === './' && m.scope === './');
  check('manifest: its own window', m.display === 'standalone');
  check('manifest: icons at 192 and 512, and one for masks', ['192x192', '512x512'].every((s) => m.icons.some((i) => i.sizes === s && i.purpose !== 'maskable')) && m.icons.some((i) => i.purpose === 'maskable') && m.icons.every((i) => files.includes(i.src)));
  check('manifest: opens phone backups (.tar)', m.file_handlers?.some((h) => Object.values(h.accept).flat().includes('.tar')));
  check('manifest: one window, focused when a file is opened', [].concat(m.launch_handler?.client_mode)[0] === 'focus-existing');
  check('manifest: shortcuts open what exists', (m.shortcuts || []).every((s) => files.includes(s.url.replace(/^\.\//, '').replace(/[?#].*$/, '') || 'index.html')));

  // The published hashes.
  const sums = read('SHA256SUMS.txt').trim().split('\n').map((l) => l.split('  '));
  check('SHA256SUMS.txt: every file, with its SHA-256', sums.length === files.length - 1 && sums.every(([h, f]) => sha256(readFileSync(join(app, f))) === h), `${sums.length} of ${files.length - 1}`);

  // The same source makes the same app, so anyone can check what's served.
  build(join(tmp, 'b'));
  check('two builds are identical', readFileSync(join(tmp, 'b', 'app', 'SHA256SUMS.txt'), 'utf8') === read('SHA256SUMS.txt') && readFileSync(join(tmp, 'b', 'app', 'sw.js'), 'utf8') === sw);
  check('theme.css hides the extension\'s controls in the app', readFileSync('extension/theme.css', 'utf8').includes('html.app .ext-only, html:not(.app) .app-only { display: none !important; }'));
  check('the build leaves nothing behind it shouldn\'t', !existsSync(join(tmp, 'a', 'app', 'peoplelib')));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
